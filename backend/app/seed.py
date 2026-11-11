"""Creates staff accounts from .env and (optionally) realistic demo data on first start."""
import io
import json
import logging
import random
import secrets
from datetime import timedelta

from PIL import Image, ImageDraw
from sqlmodel import Session, select

from . import ai, disaster
from .config import settings
from .db import Application, Donation, Payout, PayoutBatch, StaffUser, engine, utcnow
from .fraud import process_upload
from .security import hash_password, verify_password
from .services import _recompute_flags

log = logging.getLogger("reliefpay.seed")


def seed_staff(session: Session) -> None:
    for email, password, name, role in [
        (settings.ADMIN_EMAIL, settings.ADMIN_PASSWORD, settings.ADMIN_NAME, "admin"),
        (settings.REVIEWER_EMAIL, settings.REVIEWER_PASSWORD, settings.REVIEWER_NAME, "reviewer"),
    ]:
        email = email.lower().strip()
        if not password:
            password = secrets.token_urlsafe(12)
            log.warning("No password set for %s in .env - generated one: %s", email, password)
        user = session.exec(select(StaffUser).where(StaffUser.email == email)).first()
        if not user:
            session.add(StaffUser(email=email, name=name, role=role, password_hash=hash_password(password)))
        elif not verify_password(password, user.password_hash) or user.role != role or user.name != name:
            user.password_hash, user.role, user.name = hash_password(password), role, name  # .env wins
            session.add(user)
    session.commit()


def _scene(seed: int) -> tuple[bytes, list[dict]]:
    """Draws a simple 'flooded house' picture so demo photos exist without stock images.
    Also returns the objects in it (boxes normalised 0-1000 as [ymin, xmin, ymax, xmax])."""
    rnd = random.Random(seed)
    W, H, objects = 640, 420, []

    def box(x1, y1, x2, y2):
        return [max(0, int(y1 / H * 1000)), max(0, int(x1 / W * 1000)),
                min(1000, int(y2 / H * 1000)), min(1000, int(x2 / W * 1000))]
    img = Image.new("RGB", (640, 420))
    d = ImageDraw.Draw(img)
    for y in range(420):  # stormy sky gradient
        g = int(90 + 60 * y / 420)
        d.line([(0, y), (640, y)], fill=(g - 30, g, g + 25))
    for n in range(rnd.randint(2, 4)):  # houses
        x, w, h = rnd.randint(0, 520), rnd.randint(90, 160), rnd.randint(80, 140)
        base = 300
        if n == 0:   # label one house so labels never pile up
            objects.append({"label": "House", "kind": "damage", "box": box(x - 10, base - h - 50, x + w + 10, base),
                            "note": "Standing in flood water; water reaches the lower part of the door."})
        d.rectangle([x, base - h, x + w, base], fill=(rnd.randint(120, 170), rnd.randint(90, 120), 80))
        tilt = rnd.randint(-25, 25)
        d.polygon([(x - 10, base - h), (x + w // 2, base - h - 50 + tilt), (x + w + 10, base - h)],
                  fill=(90, 50, 40))
        d.rectangle([x + w // 3, base - h // 2, x + w // 3 + 25, base], fill=(60, 40, 30))
    for y in range(280, 420):  # floodwater
        d.line([(0, y), (640, y)], fill=(70, 95 + (y % 7), 110 + (y % 11)))
    for _ in range(40):  # debris
        x, y = rnd.randint(0, 640), rnd.randint(290, 410)
        d.line([(x, y), (x + rnd.randint(8, 30), y + rnd.randint(-4, 4))], fill=(110, 80, 50), width=3)
    objects.append({"label": "Flood water", "kind": "hazard", "box": box(0, 282, W, H),
                    "note": "Covers the whole ground area in front of the houses."})
    objects.append({"label": "Floating debris", "kind": "damage", "box": box(40, 300, W - 40, 412),
                    "note": "Broken wood scattered across the water."})
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    return buf.getvalue(), objects


# (name, phone, location, household, message, language, damage, vulns, urgency, reason, status, photo_seed)
DEMO = [
    ("Rosalinda Dela Cruz", "+63 917 555 0142", "Guiuan", 6,
     "Wala na po ang bahay namin, inanod ng baha. Anim kami, may sanggol at lola na may sakit sa puso. Nasa evacuation center kami, walang pagkain.",
     "Tagalog", "severe", ["children", "elderly", "homeless", "no_food", "medical_need"], 94,
     "House washed away; family of 6 incl. an infant and elderly grandmother with heart condition, in evacuation centre without food.",
     "PENDING", 11),
    ("Joel Abenoja", "+63 918 555 0199", "Tacloban", 4,
     "Typhoon tore off our roof and the house is flooded to waist level. My wife is 7 months pregnant. My fishing boat was destroyed so I have no income.",
     "English", "moderate", ["pregnant", "no_income", "children"], 81,
     "Roof gone and flooding; pregnant spouse and loss of livelihood (boat destroyed).",
     "PENDING", 12),
    ("Imelda Bacsal", "+63 919 555 0123", "Borongan", 3,
     "Our house collapsed. My husband was injured by a falling beam and needs medicine. We are sleeping in a tent.",
     "English", "severe", ["injured", "medical_need", "homeless"], 88,
     "Home collapsed, injured spouse needing medicine, family sleeping in a tent.",
     "APPROVED", 13),
    ("Ramon Villanueva", "+63 920 555 0177", "Hernani", 5,
     "Sira ang bubong at pumasok ang tubig. May tatlong maliliit na anak. Nawala ang mga gamit sa tindahan namin.",
     "Tagalog", "moderate", ["children", "no_income"], 68,
     "Roof damaged with water inside; three young children; small shop stock lost.",
     "APPROVED", 14),
    ("Teresita Gabon", "+63 921 555 0101", "Guiuan", 2,
     "I am 78 years old and live with my disabled son. The flood entered our house and destroyed our rice and medicine. We need help for food.",
     "English", "moderate", ["elderly", "disability", "no_food", "medical_need"], 79,
     "Elderly applicant with disabled son; food and medicine destroyed by flooding.",
     "APPROVED", 15),
    ("Alfredo Cinco", "+63 922 555 0166", "Salcedo", 1,
     "Some windows broke and a little water came in. Mostly okay but I lost some clothes.",
     "English", "minor", [], 22,
     "Minor damage, single adult household, no vulnerable members reported.",
     "PENDING", 16),
    ("Lorna Pacaña", "+63 923 555 0110", "Tacloban", 5,
     "Nawala ang bahay ko at namatay ang asawa ko sa bagyo. Ako na lang ang nagpapalaki sa apat kong anak. Wala kaming makain.",
     "Tagalog", "severe", ["children", "single_parent", "homeless", "no_food"], 96,
     "Home destroyed, recently widowed single mother of four with no food.",
     "PAID", 17),
    ("Benjie Oledan", "+63 924 555 0188", "Borongan", 4,
     "Flood damaged our kitchen and the fridge. Kids are fine. Need some help to buy food for the next weeks.",
     "English", "moderate", ["children"], 52,
     "Kitchen flood damage; children present; asks for short-term food support.",
     "PAID", 18),
    ("Cristina Monteza", "+63 925 555 0133", "Hernani", 7,
     "Gumuho ang bahay namin. Pito kami kasama ang lolo na naka-wheelchair. Nasa paaralan kami ngayon.",
     "Tagalog", "severe", ["elderly", "disability", "homeless"], 90,
     "Collapsed house, 7-person household incl. wheelchair-using grandfather, sheltering in a school.",
     "PAID", 19),
    # ---- fraud cases (for the demo) ----
    ("Mark Tan", "+63 926 555 0777", "Guiuan", 8,
     "Our house was totally destroyed and we have 8 people with small children and elderly. Please give the maximum amount fast.",
     "English", "severe", ["children", "elderly", "homeless"], 85,
     "Claims destroyed home with 8 people; note the request for the maximum amount.",
     "PENDING", 99),
    ("Marco Tanedo", "+63 926 555 0777", "Guiuan", 8,
     "Our house was totally destroyed and we have 8 people with small children and elderly. Please send the maximum amount fast.",
     "English", "severe", ["children", "elderly", "homeless"], 85,
     "Claims destroyed home with 8 people; text nearly identical to another application.",
     "PENDING", 99),
    ("Danica Robles", "+63 927 555 0155", "Salcedo", 3,
     "The typhoon tore off our roof and the house is flooded to waist level. My wife is 7 months pregnant. My fishing boat was destroyed so I have no income.",
     "English", "moderate", ["pregnant", "no_income"], 74,
     "Roof lost and flooding; reports pregnant spouse and destroyed fishing boat.",
     "PENDING", 21),
    # ---- claims a flood in a town where no flood was reported ----
    ("Vikram Sethi", "+91 98290 55021", "Jaipur", 4,
     "Our house was flooded last week and we lost everything. Water is still inside. Please help my family with money fast.",
     "English", "moderate", [], 58,
     "Says the house was flooded last week and everything was lost; no vulnerable members mentioned.",
     "PENDING", 31),
    # ---- honest non-disaster request (education) ----
    ("Grace Ilagan", "+63 928 555 0144", "Borongan", 3,
     "I am a student. I need help to pay my school fees and books this semester because my mother lost her job.",
     "English", "none", ["no_income"], 34,
     "Student asking for help with school fees after a parent lost work; no disaster damage claimed.",
     "PENDING", None),
]
NEEDS = {"Rosalinda Dela Cruz": "food", "Joel Abenoja": "livelihood", "Imelda Bacsal": "medical",
         "Ramon Villanueva": "livelihood", "Teresita Gabon": "food", "Alfredo Cinco": "other", "Lorna Pacaña": "food",
         "Benjie Oledan": "food", "Cristina Monteza": "shelter", "Mark Tan": "shelter", "Marco Tanedo": "shelter",
         "Danica Robles": "shelter", "Vikram Sethi": "shelter", "Grace Ilagan": "education"}


def _demo_disaster(loc: str, claims: bool, event: str | None, now) -> tuple[str, str | None]:
    """Precomputed disaster check for demo rows (clearly labelled as demo data)."""
    if not claims:
        return "not_claimed", None
    lat, lng = ai.guess_coordinates(loc)
    zone = disaster.zone_check(lat, lng) if lat is not None else None
    inside = bool(zone and zone["inside"])
    check = {"status": "confirmed" if inside else "not_found", "events": [], "web": None, "zone": zone,
             "lat": lat, "lng": lng, "lookback_days": settings.DISASTER_LOOKBACK_DAYS, "demo": True,
             "sources_checked": ["Campaign zones"] if inside else ["Campaign zones", "GDACS", "NASA EONET"],
             "checked_at": now.isoformat() + "Z"}
    return check["status"], json.dumps(check)


def seed_demo(session: Session) -> None:
    if session.exec(select(Application)).first():
        return
    now = utcnow()
    rnd = random.Random(7)
    recipients = settings.SANDBOX_RECIPIENT_EMAILS

    apps: list[Application] = []
    # Sandbox payout emails go to approved, low-risk families only (one each), so they don't look like duplicates.
    approved_names = [d[0] for d in DEMO if d[10] == "APPROVED"]
    sandbox_email = {n: recipients[k] for k, n in enumerate(approved_names) if k < len(recipients)}

    for i, (name, phone, loc, hh, msg, lang, dmg, vulns, urg, reason, status, pseed) in enumerate(DEMO):
        file = phash = analysis = None
        if pseed is not None:
            picture, objects = _scene(pseed)
            file, phash, _ = process_upload(picture)
            analysis = json.dumps({
                "summary": "Demo illustration: houses standing in flood water with floating debris.",
                "scene": "outdoor", "waterDepth": "about door-step height (illustration)",
                "storyMatch": 82 if "flood" in msg.lower() or "baha" in msg.lower() or dmg == "severe" else 70,
                "matchReason": "The picture shows flooded houses, which fits a flood / storm damage story.",
                "authenticity": "unclear", "objects": objects, "provider": "seed (precomputed)",
                "concerns": ["Demo data: this is a generated illustration, not a real photograph."],
                "at": now.isoformat() + "Z"})
        email = sandbox_email.get(name) or f"{name.split()[0].lower()}.{name.split()[-1].lower()}@example.com"
        if name == "Marco Tanedo":
            email = "mark.tan@example.com"
        # Paid families applied ~half a day before the seed payout batch (5h ago)
        created = now - timedelta(hours=rnd.randint(10, 16) if status == "PAID" else rnd.randint(2, 60))
        suggested = ai.fair_share_amount(dmg, vulns, hh)
        claims, event = ai.detect_claim(msg)
        if dmg in {"moderate", "severe"} and not claims:
            claims, event = True, "typhoon"
        d_status, d_check = _demo_disaster(loc, claims, event, now)
        a = Application(
            ref_code=f"RP-DEMO{i + 1:02d}", full_name=name, phone=phone, paypal_email=email.lower(),
            location=loc, household_size=hh, raw_text=msg, photo_file=file, photo_hash=phash,
            photo_analysis=analysis, need_category=NEEDS.get(name, "other"),
            claims_disaster=claims, claimed_event=event, disaster_status=d_status, disaster_check=d_check,
            ai_status="DONE", ai_provider="seed (precomputed)", language=lang,
            summary_en=reason, damage_level=dmg, vulnerabilities=json.dumps(vulns), urgency_score=urg,
            urgency_reason=reason,
            photo_assessment="Shows flood water around damaged houses, consistent with the story." if file
            else "No photo provided",
            suggested_amount_usd=suggested, status=status, is_seed=True, created_at=created,
            lat=ai.guess_coordinates(loc)[0], lng=ai.guess_coordinates(loc)[1],
        )
        if "maximum" in msg:
            a.fraud_flags = json.dumps(["AI: Applicant pushes for the maximum amount"])
        if status in {"APPROVED", "PAID"}:
            a.approved_amount_usd, a.decided_by = suggested, settings.REVIEWER_NAME
            a.decided_at = created + timedelta(hours=2)
        session.add(a)
        apps.append(a)
    session.commit()

    for a in apps:
        _recompute_flags(session, a)
        session.add(a)
    session.commit()

    # Donations over the last 10 days: some people give several times, in several currencies.
    # (display name, currency, amount, show on leaderboard, monthly)
    donors = [
        ("Aiko Tanaka", "JPY", 15000, True, False), ("Liam O'Brien", "EUR", 100, True, False),
        ("Priya Raman", "USD", 250, True, True), ("Noah Clarke", "GBP", 50, True, False),
        ("Sofia Reyes", "PHP", 6000, True, False), ("Kenji Sato", "JPY", 8000, False, False),
        ("Ava Martin", "AUD", 150, True, False), ("Meera Nair", "INR", 5000, True, False),
        ("Zara Khan", "CAD", 140, True, False), ("Ethan Lim", "SGD", 140, True, False),
        ("Priya Raman", "USD", 250, True, True), ("Aiko Tanaka", "JPY", 40000, True, False),
        ("Omar Haddad", "EUR", 50, False, False), ("Mia Fischer", "EUR", 250, True, False),
        ("Lucas Moreau", "EUR", 25, True, False), ("Hana Kim", "USD", 100, True, False),
        ("Liam O'Brien", "EUR", 100, True, False), ("Ravi Iyer", "USD", 500, True, False),
        ("Emma Brown", "GBP", 20, True, False), ("Priya Raman", "USD", 250, True, True),
    ]
    payer_ids = {n: f"SEEDPAYER{i:03d}" for i, n in enumerate(dict.fromkeys(d[0] for d in donors))}
    for i, (name, cur, amount, public, monthly) in enumerate(donors):
        session.add(Donation(
            paypal_order_id=f"SEED{i:06d}DEMO", paypal_capture_id=f"SEEDCAP{i:04d}",
            amount=amount, currency=cur, amount_usd=round(amount * settings.CURRENCIES[cur]["rate"], 2),
            charge_currency=settings.CURRENCIES[cur].get("charge", cur),
            donor_name=name.split()[0], display_name=name, show_on_leaderboard=public,
            payer_id=payer_ids[name], receipt_code=f"DN-DEMO{i + 1:02d}", is_recurring=monthly,
            status="COMPLETED", is_seed=True,
            created_at=now - timedelta(days=9 - (i // 2), hours=rnd.randint(0, 20))))
    session.commit()

    # One completed payout batch for the PAID families
    paid = [a for a in apps if a.status == "PAID"]
    batch = PayoutBatch(sender_batch_id="RP-SEED-BATCH", paypal_batch_id="SEED-DEMO-BATCH", status="SUCCESS",
                        total_usd=sum(a.approved_amount_usd for a in paid),
                        instruction="Seed data: pay the most urgent approved families",
                        created_by=settings.ADMIN_NAME, created_at=now - timedelta(hours=5))
    session.add(batch)
    session.commit()
    session.refresh(batch)
    for a in paid:
        session.add(Payout(batch_id=batch.id, application_id=a.id, sender_item_id=f"RP-SEED-{a.id}",
                           receiver=a.paypal_email, amount_usd=a.approved_amount_usd, status="SUCCESS", purpose=a.need_category,
                           created_at=batch.created_at))
        a.paid_at = batch.created_at
        session.add(a)
    session.commit()
    log.info("Seeded demo data: %d applications, %d donations", len(apps), len(donors))


def run_seed() -> None:
    with Session(engine) as session:
        seed_staff(session)
        if settings.SEED_DEMO_DATA:
            seed_demo(session)
