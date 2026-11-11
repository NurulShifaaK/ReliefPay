"""Business logic shared by routers: money, triage runner, payout planning, donor impact, serializers."""
import json
import secrets
from collections import defaultdict
from datetime import datetime, timedelta

from sqlmodel import Session, func, select

from . import ai, disaster
from .config import settings
from .db import (RESERVED_PAYOUT_STATUSES, Application, Donation, Payout, engine, utcnow)
from .fraud import find_fraud_signals, risk_level

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I confusion


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat() + "Z" if dt else None


def new_code(prefix: str) -> str:
    return f"{prefix}-" + "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))


# ---------- currencies ----------
def to_usd(amount: float, currency: str) -> float:
    return round(amount * settings.CURRENCIES[currency]["rate"], 2)


def money_text(amount: float | None, currency: str | None) -> str:
    cur = currency or "USD"
    meta = settings.CURRENCIES.get(cur, {"symbol": cur + " ", "decimals": 2})
    return f"{meta['symbol']}{(amount or 0):,.{meta['decimals']}f}"


# ---------- money ----------
def funds(session: Session) -> dict:
    raised = session.exec(select(func.coalesce(func.sum(Donation.amount_usd), 0.0))
                          .where(Donation.status == "COMPLETED")).one()
    donors = session.exec(select(func.count(Donation.id)).where(Donation.status == "COMPLETED")).one()
    reserved = session.exec(select(func.coalesce(func.sum(Payout.amount_usd), 0.0))
                            .where(Payout.status.in_(RESERVED_PAYOUT_STATUSES))).one()
    sent = session.exec(select(func.coalesce(func.sum(Payout.amount_usd), 0.0))
                        .where(Payout.status == "SUCCESS")).one()
    return {"raisedUsd": round(raised, 2), "donors": donors, "committedUsd": round(reserved, 2),
            "sentUsd": round(sent, 2), "availableUsd": round(max(raised - reserved, 0), 2)}


def average_aid_usd(session: Session) -> float:
    """Average amount one family receives (paid or approved); falls back to a typical suggestion."""
    avg = session.exec(select(func.avg(Application.approved_amount_usd))
                       .where(Application.status.in_(["PAID", "APPROVED"]))).one()
    if not avg:
        avg = session.exec(select(func.avg(Application.suggested_amount_usd))).one()
    return round(float(avg or 200), 2)


# ---------- AI triage ----------
def _recompute_flags(session: Session, app: Application) -> None:
    ai_flags = [f for f in app.flags() if f.startswith("AI: ")]
    flags = find_fraud_signals(session, app) + ai_flags
    app.fraud_flags = json.dumps(flags)
    level = risk_level([f for f in flags if not f.startswith("AI: ")])
    app.fraud_risk = "medium" if (level == "low" and ai_flags) else level


async def run_triage(app_id: int) -> None:
    """Runs in the background after an application is submitted (or on re-run)."""
    with Session(engine) as session:
        app = session.get(Application, app_id)
        if not app:
            return
        image = None
        if app.photo_file:
            path = settings.upload_dir / app.photo_file
            if path.is_file():
                image = path.read_bytes()
        try:
            result, provider = await ai.triage(app.raw_text, app.location, app.household_size, image)
        except Exception:  # never crash the worker; staff can re-run
            ai.log.exception("Triage crashed")
            app.ai_status = "ERROR"
            session.add(app)
            session.commit()
            return

        app.ai_provider = provider
        app.ai_error = ai.last_error["message"] if "unavailable" in provider else None
        app.language = result["language"]
        app.summary_en = result["summary_en"]
        app.damage_level = result["damage_level"]
        app.vulnerabilities = json.dumps(result["vulnerabilities"])
        app.urgency_score = result["urgency_score"]
        app.urgency_reason = result["urgency_reason"]
        app.photo_assessment = result["photo_assessment"]
        app.lat, app.lng = result.get("lat"), result.get("lng")
        app.suggested_amount_usd = ai.fair_share_amount(
            result["damage_level"], result["vulnerabilities"], app.household_size)
        app.claims_disaster = bool(result.get("claims_disaster"))
        app.claimed_event = result.get("claimed_event")
        if not app.need_category:
            app.need_category = result.get("need_category") or "other"
        await _verify_disaster(app)
        app.fraud_flags = json.dumps([f"AI: {c}" for c in result["concerns"]])
        _recompute_flags(session, app)
        app.ai_status = "DONE"
        session.add(app)

        # Duplicates are two-way: refresh flags on the applications this one matches.
        for other in session.exec(select(Application).where(Application.id != app.id)).all():
            if other.ref_code in app.fraud_flags:
                _recompute_flags(session, other)
                session.add(other)
        session.commit()


async def _verify_disaster(app: Application) -> None:
    """Check the claimed disaster against official data + news. Never raises, never rejects."""
    if not app.claims_disaster:
        app.disaster_status, app.disaster_check = "not_claimed", None
        return
    if not settings.DISASTER_CHECK:
        app.disaster_status, app.disaster_check = "unknown", None
        return
    try:
        check = await disaster.check_disaster(app.location, app.claimed_event)
    except Exception:
        disaster.log.exception("Disaster check crashed")
        app.disaster_status, app.disaster_check = "unknown", None
        return
    app.disaster_status = check["status"]
    app.disaster_check = json.dumps(check)
    if check.get("lat") is not None and app.lat is None:
        app.lat, app.lng = check["lat"], check["lng"]


# ---------- payout planning ----------
def build_plan(session: Session, filters: dict) -> dict:
    """Deterministic, rule-checked selection. The AI only supplied the filters."""
    available = funds(session)["availableUsd"]
    per_cap = min(filters.get("max_per_family_usd") or settings.MAX_PAYOUT_PER_FAMILY_USD,
                  settings.MAX_PAYOUT_PER_FAMILY_USD)
    budget = min(filters.get("total_budget_usd") or settings.MAX_BATCH_TOTAL_USD,
                 settings.MAX_BATCH_TOTAL_USD, available)

    apps = session.exec(select(Application).where(Application.status == "APPROVED")).all()
    items, skipped, total = [], [], 0.0
    allowed_risk = {"low", "medium"} if filters.get("include_medium_risk") else {"low"}
    apps.sort(key=lambda a: (a.urgency_score or 0), reverse=True)
    for a in apps:
        if filters.get("min_urgency") is not None and (a.urgency_score or 0) < filters["min_urgency"]:
            continue
        if filters.get("locations") and a.location not in filters["locations"]:
            continue
        if a.marked_fraud:
            continue
        if a.claims_disaster and a.disaster_status == "not_found":
            skipped.append({"ref": a.ref_code, "reason": "disaster not confirmed (pay individually with a written reason)"})
            continue
        if a.fraud_risk not in allowed_risk:
            skipped.append({"ref": a.ref_code, "reason": f"{a.fraud_risk} fraud risk"
                            + (" (say 'include flagged cases' to add)" if a.fraud_risk == "medium" else "")})
            continue
        if not a.receiver:
            skipped.append({"ref": a.ref_code, "reason": "no payout account"})
            continue
        amount = round(min(a.approved_amount_usd or a.suggested_amount_usd or 0, per_cap), 2)
        if amount <= 0:
            continue
        if total + amount > budget + 1e-9:
            skipped.append({"ref": a.ref_code, "reason": "over budget"})
            continue
        total += amount
        items.append({"application_id": a.id, "ref": a.ref_code, "name": a.full_name,
                      "need": a.need_category or "other", "disaster": a.disaster_status,
                      "location": a.location, "urgency": a.urgency_score, "amount_usd": amount,
                      "receiver": a.receiver, "method": a.payout_method or "PAYPAL", "risk": a.fraud_risk})
    return {"items": items, "skipped": skipped, "total_usd": round(total, 2), "budget_usd": round(budget, 2),
            "per_family_cap_usd": per_cap, "available_usd": available}


def agent_tools(session: Session) -> dict:
    """Read-only tools the Payout Agent may call. They never return names, phones or emails."""
    def approved():
        return session.exec(select(Application).where(Application.status == "APPROVED")).all()

    def get_funds(_args):
        f = funds(session)
        return {"available_usd": f["availableUsd"], "raised_usd": f["raisedUsd"],
                "committed_usd": f["committedUsd"], "max_per_family_usd": settings.MAX_PAYOUT_PER_FAMILY_USD,
                "max_batch_usd": settings.MAX_BATCH_TOTAL_USD}

    def list_towns(_args):
        counts: dict[str, int] = defaultdict(int)
        for a in approved():
            if a.fraud_risk != "high":
                counts[a.location] += 1
        return {"towns": [{"town": t, "approved_families": n} for t, n in sorted(counts.items(), key=lambda x: -x[1])]}

    def list_families(args):
        towns = {t.lower() for t in (args.get("towns") or [])}
        if args.get("town"):
            towns.add(str(args["town"]).lower())
        try:
            min_u = int(args["min_urgency"]) if args.get("min_urgency") is not None else None
        except (TypeError, ValueError):
            min_u = None
        rows = []
        for a in approved():
            if towns and a.location.lower() not in towns:
                continue
            if min_u is not None and (a.urgency_score or 0) < min_u:
                continue
            rows.append({"ref": a.ref_code, "town": a.location, "urgency": a.urgency_score,
                         "fraud_risk": a.fraud_risk, "need": a.need_category, "disaster_check": a.disaster_status,
                         "amount_usd": a.approved_amount_usd or a.suggested_amount_usd})
        rows.sort(key=lambda r: -(r["urgency"] or 0))
        return {"count": len(rows), "families": rows[:50]}

    def summarise(name, args, result):
        if name == "get_funds":
            return f"Checked funds: ${result['available_usd']:,.0f} available"
        if name == "list_towns":
            return "Towns with approved families: " + (", ".join(
                f"{t['town']} ({t['approved_families']})" for t in result["towns"][:5]) or "none")
        if name == "list_approved_families":
            where = args.get("town") or ", ".join(args.get("towns") or []) or "all towns"
            extra = f", urgency ≥ {args['min_urgency']}" if args.get("min_urgency") is not None else ""
            return f"Looked up approved families ({where}{extra}): {result['count']} found"
        return name

    return {"get_funds": get_funds, "list_towns": list_towns, "list_approved_families": list_families,
            "_summarise": summarise}


# ---------- donor impact: "follow my dollar" ----------
def allocations(session: Session) -> dict[int, list[dict]]:
    """Match money out to money in, oldest donation first (FIFO). Returns donation_id -> slices."""
    donations = session.exec(select(Donation).where(Donation.status == "COMPLETED")
                             .order_by(Donation.created_at, Donation.id)).all()
    payouts = session.exec(select(Payout, Application).join(Application, Payout.application_id == Application.id)
                           .where(Payout.status.in_(RESERVED_PAYOUT_STATUSES))
                           .order_by(Payout.created_at, Payout.id)).all()
    remaining = [[d.id, d.amount_usd] for d in donations]
    out: dict[int, list[dict]] = defaultdict(list)
    i = 0
    for p, a in payouts:
        need = p.amount_usd
        while need > 0.004 and i < len(remaining):
            take = min(need, remaining[i][1])
            if take > 0.004:
                out[remaining[i][0]].append({"applicationId": a.id, "location": a.location,
                                             "amount": round(take, 2), "at": iso(p.created_at), "status": p.status})
            remaining[i][1] -= take
            need -= take
            if remaining[i][1] <= 0.004:
                i += 1
    return out


def leaderboard(session: Session, allocs: dict[int, list[dict]] | None = None, limit: int = 10) -> list[dict]:
    """Top donors who chose to be shown. Grouped by PayPal payer, with families their money reached."""
    allocs = allocs if allocs is not None else allocations(session)
    groups: dict[str, dict] = {}
    for d in session.exec(select(Donation).where(Donation.status == "COMPLETED").order_by(Donation.created_at)).all():
        key = d.payer_id or f"donation-{d.id}"
        g = groups.setdefault(key, {"total": 0.0, "count": 0, "families": set(), "towns": set(),
                                    "show": False, "name": None, "monthly": False})
        g["total"] += d.amount_usd
        g["count"] += 1
        g["monthly"] = g["monthly"] or bool(d.is_recurring)
        if d.show_on_leaderboard:
            g["show"] = True
            g["name"] = d.display_name or g["name"]
        for s in allocs.get(d.id, []):
            g["families"].add(s["applicationId"])
            g["towns"].add(s["location"])
    rows = [{"name": g["name"] or "A kind donor", "totalUsd": round(g["total"], 2), "donations": g["count"],
             "familiesHelped": len(g["families"]), "towns": sorted(g["towns"]), "monthly": g["monthly"]}
            for g in groups.values() if g["show"]]
    rows.sort(key=lambda r: (-r["totalUsd"], -r["familiesHelped"]))
    return rows[:limit]


# ---------- situation report numbers ----------
def report_stats(session: Session) -> dict:
    now = utcnow()
    apps = session.exec(select(Application)).all()
    f = funds(session)
    open_by_town: dict[str, int] = defaultdict(int)
    for a in apps:
        if a.status == "PENDING":
            open_by_town[a.location] += 1
    return {
        "new_requests_24h": sum(1 for a in apps if a.created_at >= now - timedelta(hours=24)),
        "pending": sum(1 for a in apps if a.status == "PENDING"),
        "urgent_pending": sum(1 for a in apps if a.status == "PENDING" and (a.urgency_score or 0) >= 80),
        "approved_unpaid": sum(1 for a in apps if a.status == "APPROVED"),
        "approved_unpaid_usd": round(sum((a.approved_amount_usd or 0) for a in apps if a.status == "APPROVED"), 2),
        "families_paid": sum(1 for a in apps if a.status == "PAID"),
        "high_risk": sum(1 for a in apps if a.fraud_risk == "high"),
        "marked_fraud": sum(1 for a in apps if a.marked_fraud),
        "disaster_not_confirmed": sum(1 for a in apps if a.disaster_status == "not_found"),
        "needs": {n: sum(1 for a in apps if (a.need_category or "other") == n) for n in ai.NEED_CATEGORIES},
        "languages": sorted({a.language for a in apps if a.language}),
        "needs_by_town": [{"town": t, "requests": n} for t, n in sorted(open_by_town.items(), key=lambda x: -x[1])][:5],
        "raised_usd": f["raisedUsd"], "available_usd": f["availableUsd"], "sent_usd": f["sentUsd"],
    }


# ---------- serializers ----------
def app_public(a: Application) -> dict:
    return {
        "id": a.id, "ref": a.ref_code, "fullName": a.full_name, "phone": a.phone,
        "paypalEmail": a.paypal_email, "payoutMethod": a.payout_method or "PAYPAL", "venmoPhone": a.venmo_phone,
        "receiver": a.receiver, "location": a.location, "lat": a.lat, "lng": a.lng,
        "householdSize": a.household_size, "message": a.raw_text, "hasPhoto": bool(a.photo_file),
        "need": a.need_category or "other",
        "disaster": {"claims": bool(a.claims_disaster), "event": a.claimed_event, "status": a.disaster_status,
                     "check": json.loads(a.disaster_check) if a.disaster_check else None},
        "markedFraud": bool(a.marked_fraud), "fraudReason": a.fraud_reason, "markedBy": a.marked_by,
        "photoAnalysis": json.loads(a.photo_analysis) if a.photo_analysis else None,
        "ai": {"status": a.ai_status, "provider": a.ai_provider, "error": a.ai_error, "language": a.language,
               "summary": a.summary_en, "damage": a.damage_level, "vulnerabilities": a.vulns(),
               "urgency": a.urgency_score, "reason": a.urgency_reason,
               "photoAssessment": a.photo_assessment, "suggestedAmount": a.suggested_amount_usd},
        "fraud": {"risk": a.fraud_risk, "flags": a.flags()},
        "status": a.status, "approvedAmount": a.approved_amount_usd, "decisionNote": a.decision_note,
        "decidedBy": a.decided_by, "decidedAt": iso(a.decided_at), "paidAt": iso(a.paid_at),
        "createdAt": iso(a.created_at), "isSeed": a.is_seed,
    }
