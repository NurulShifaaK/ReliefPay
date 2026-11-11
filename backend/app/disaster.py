"""Did the disaster an applicant describes really happen?

Sources (all free, called from the server, every call fails safely):
  1. The NGO's own active campaign zones (settings.DISASTER_ZONES)
  2. GDACS  - UN/EU Global Disaster Alert and Coordination System (floods, cyclones, earthquakes)
  3. NASA EONET - Earth Observatory Natural Event Tracker (floods, severe storms)
  4. The AI with live web search (news reports), when an AI key is set

The result is NEVER a rejection. "not_found" becomes a warning for staff to check before paying;
"unknown" (every source failed) raises no flag at all.
"""
import asyncio
import logging
import math
import time
from datetime import datetime, timedelta, timezone

import httpx

from . import ai
from .config import settings

log = logging.getLogger("reliefpay.disaster")

GDACS_URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

GDACS_TYPES = {"FL": "flood", "TC": "typhoon", "EQ": "earthquake", "VO": "volcano", "WF": "fire", "DR": "drought"}
# Which reported event types support which claim
RELATED = {
    "flood": {"flood", "typhoon", "cyclone", "storm"},
    "typhoon": {"typhoon", "cyclone", "storm", "flood"},
    "cyclone": {"typhoon", "cyclone", "storm", "flood"},
    "storm": {"typhoon", "cyclone", "storm", "flood"},
    "landslide": {"landslide", "flood", "typhoon", "cyclone", "storm", "earthquake"},
    "earthquake": {"earthquake"},
    "fire": {"fire"},
    "drought": {"drought"},
}

_cache: dict[str, tuple[float, object]] = {}
_geo_lock = asyncio.Lock()
_geo_last = 0.0


def _cached(key: str, ttl: float):
    hit = _cache.get(key)
    return hit[1] if hit and time.time() - hit[0] < ttl else None


def _store(key: str, value):
    if len(_cache) > 2000:
        _cache.clear()
    _cache[key] = (time.time(), value)
    return value


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def zone_check(lat: float, lng: float) -> dict | None:
    """Nearest active campaign zone: {name, event, distance_km, inside}."""
    best = None
    for z in settings.DISASTER_ZONES:
        try:
            d = haversine_km(lat, lng, float(z["lat"]), float(z["lng"]))
            item = {"name": str(z.get("name", "Campaign zone")), "event": str(z.get("event", "disaster")),
                    "distance_km": round(d), "inside": d <= float(z.get("radius_km", 100))}
        except (KeyError, TypeError, ValueError):
            continue
        if best is None or item["distance_km"] < best["distance_km"]:
            best = item
    return best


async def geocode(place: str) -> tuple[float, float] | None:
    """Town -> coordinates. Small built-in list first, then OpenStreetMap Nominatim (max 1 request/second)."""
    global _geo_last
    key = "geo:" + place.strip().lower()
    hit = _cached(key, 7 * 86400)
    if hit is not None:
        return hit or None
    lat, lng = ai.guess_coordinates(place)
    if lat is not None:
        return _store(key, (lat, lng))
    try:
        async with _geo_lock:
            wait = 1.1 - (time.time() - _geo_last)
            if wait > 0:
                await asyncio.sleep(wait)
            async with httpx.AsyncClient(timeout=10, headers={"User-Agent": settings.GEOCODER_USER_AGENT}) as c:
                r = await c.get(NOMINATIM_URL, params={"q": place[:120], "format": "jsonv2", "limit": 1})
            _geo_last = time.time()
        if r.status_code == 200 and r.json():
            top = r.json()[0]
            return _store(key, (round(float(top["lat"]), 4), round(float(top["lon"]), 4)))
        if r.status_code == 200:
            _store(key, ())          # really not found: remember that for a week
    except (httpx.HTTPError, KeyError, ValueError, IndexError) as e:
        log.warning("Geocoding failed for %r: %s", place, e)
    return None


def _point(geometry) -> tuple[float, float] | None:
    """Pull one (lat, lng) out of a GeoJSON-ish geometry (Point or the first vertex of a polygon)."""
    try:
        coords = geometry["coordinates"]
        while isinstance(coords[0], (list, tuple)):
            coords = coords[0]
        return float(coords[1]), float(coords[0])
    except (KeyError, TypeError, IndexError, ValueError):
        return None


async def _gdacs_events(days: int) -> list[dict] | None:
    key = f"gdacs:{days}:{datetime.now(timezone.utc):%Y%m%d%H}"
    hit = _cached(key, 3600)
    if hit is not None:
        return hit
    today = datetime.now(timezone.utc).date()
    params = {"eventlist": "FL;TC;EQ", "fromdate": (today - timedelta(days=days)).isoformat(),
              "todate": today.isoformat(), "alertlevel": "red;orange;green"}
    try:
        async with httpx.AsyncClient(timeout=20, headers={"User-Agent": settings.GEOCODER_USER_AGENT}) as c:
            r = await c.get(GDACS_URL, params=params)
        if r.status_code != 200:
            raise ValueError(f"HTTP {r.status_code}")
        out = []
        for f in (r.json() or {}).get("features", []):
            props, pt = f.get("properties") or {}, _point(f.get("geometry") or {})
            if not pt:
                continue
            etype = GDACS_TYPES.get(str(props.get("eventtype", "")).upper(), "other")
            out.append({"source": "GDACS", "type": etype, "lat": pt[0], "lng": pt[1],
                        "name": str(props.get("name") or props.get("eventname") or props.get("htmldescription")
                                    or f"{etype.title()} in {props.get('country', '')}")[:120],
                        "date": str(props.get("fromdate") or "")[:10],
                        "alert": str(props.get("alertlevel") or ""),
                        "url": str((props.get("url") or {}).get("report") or "") if isinstance(props.get("url"), dict) else ""})
        return _store(key, out)
    except (httpx.HTTPError, ValueError, TypeError, AttributeError) as e:
        log.warning("GDACS lookup failed: %s", e)
        return None


async def _eonet_events(days: int) -> list[dict] | None:
    key = f"eonet:{days}:{datetime.now(timezone.utc):%Y%m%d%H}"
    hit = _cached(key, 3600)
    if hit is not None:
        return hit
    try:
        async with httpx.AsyncClient(timeout=20, headers={"User-Agent": settings.GEOCODER_USER_AGENT}) as c:
            r = await c.get(EONET_URL, params={"category": "floods,severeStorms", "days": days, "status": "all"})
        if r.status_code != 200:
            raise ValueError(f"HTTP {r.status_code}")
        out = []
        for ev in (r.json() or {}).get("events", []):
            cats = " ".join(str(c.get("id", "")) + str(c.get("title", "")) for c in ev.get("categories") or []).lower()
            etype = "flood" if "flood" in cats else "storm"
            for g in (ev.get("geometry") or [])[-40:]:      # storms have a track: check every recent point
                pt = _point(g)
                if pt:
                    out.append({"source": "NASA EONET", "type": etype, "lat": pt[0], "lng": pt[1],
                                "name": str(ev.get("title") or etype.title())[:120],
                                "date": str(g.get("date") or "")[:10], "alert": "",
                                "url": str(ev.get("link") or "")})
        return _store(key, out)
    except (httpx.HTTPError, ValueError, TypeError, AttributeError) as e:
        log.warning("EONET lookup failed: %s", e)
        return None


def _nearby(events: list[dict], lat: float, lng: float, claimed: str | None) -> list[dict]:
    wanted = RELATED.get(claimed or "", None)
    best: dict[str, dict] = {}
    for e in events:
        if wanted and e["type"] not in wanted:
            continue
        d = haversine_km(lat, lng, e["lat"], e["lng"])
        radius = settings.DISASTER_RADIUS_KM * (2 if e["type"] in {"typhoon", "cyclone", "storm"} else 1)
        if d <= radius:
            k = e["source"] + e["name"]
            if k not in best or d < best[k]["distance_km"]:
                best[k] = {"source": e["source"], "type": e["type"], "name": e["name"], "date": e["date"],
                           "distance_km": round(d), "url": e["url"] if e["url"].startswith("https://") else ""}
    return sorted(best.values(), key=lambda x: x["distance_km"])[:5]


async def check_disaster(location: str, claimed_event: str | None) -> dict:
    """Returns {"status": confirmed|not_found|unknown, "events": [...], "web": {...}|None, "zone": {...}|None,
    "lat", "lng", "sources_checked": [...], "checked_at"}. Cached per (town, claim, day)."""
    day = datetime.now(timezone.utc).date().isoformat()
    key = f"check:{location.strip().lower()}:{claimed_event}:{day}"
    hit = _cached(key, 6 * 3600)
    if hit is not None:
        return hit

    days = settings.DISASTER_LOOKBACK_DAYS
    coords = await geocode(location)
    checked: list[str] = []
    events: list[dict] = []
    zone = None

    if coords:
        zone = zone_check(*coords)
        if settings.DISASTER_ZONES:
            checked.append("Campaign zones")
        gdacs, eonet = await asyncio.gather(_gdacs_events(days), _eonet_events(days))
        if gdacs is not None:
            checked.append("GDACS")
            events += _nearby(gdacs, *coords, claimed_event)
        if eonet is not None:
            checked.append("NASA EONET")
            events += _nearby(eonet, *coords, claimed_event)

    web = None
    in_zone = bool(zone and zone["inside"])
    if not events and not in_zone:           # only spend an AI search when the free sources found nothing
        web = await ai.web_disaster_check(location, claimed_event, days)
        if web is not None:
            checked.append("AI web search")

    if in_zone or events or (web and web["confirmed"] and web["confidence"] >= 0.6):
        status = "confirmed"
    elif any(c != "Campaign zones" for c in checked):   # at least one outside source really answered
        status = "not_found"
    else:
        status = "unknown"          # nothing could be checked: no flag

    result = {"status": status, "events": sorted(events, key=lambda e: e["distance_km"])[:5], "web": web,
              "zone": zone, "lat": coords[0] if coords else None, "lng": coords[1] if coords else None,
              "sources_checked": checked, "lookback_days": days,
              "checked_at": datetime.now(timezone.utc).isoformat()}
    if status != "unknown":
        _store(key, result)
    return result


def clear_cache() -> None:
    _cache.clear()
