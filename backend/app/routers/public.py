"""Public endpoints: donate (one-time / monthly, many currencies), apply, track, transparency, webhooks.
No personal data of families ever leaves these endpoints."""
import json
import logging
import re
from collections import defaultdict
from datetime import timedelta

from email_validator import EmailNotValidError, validate_email
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlmodel import Session, func, select

from .. import ai, paypal
from ..config import settings
from ..db import (Application, Donation, Payout, PayoutBatch, Setting, Subscription, WebhookEvent, audit,
                  get_session, utcnow)
from ..fraud import BadImage, process_upload
from ..security import rate_limit
from ..services import (allocations, average_aid_usd, funds, iso, leaderboard, money_text, new_code, run_triage,
                        to_usd)

router = APIRouter(prefix="/api/public", tags=["public"])
log = logging.getLogger("reliefpay.public")

ORDER_ID_RE = re.compile(r"^[A-Z0-9]{10,30}$")
SUB_ID_RE = re.compile(r"^I-[A-Z0-9]{8,30}$")
CODE_RE = re.compile(r"^(DN|RP)-[A-Z0-9]{4,10}$")


@router.get("/config")
def public_config():
    return {
        "paypalClientId": settings.PAYPAL_CLIENT_ID,
        "paypalReady": paypal.configured(),
        "campaignName": settings.CAMPAIGN_NAME,
        "goalUsd": settings.CAMPAIGN_GOAL_USD,
        "maxDonationUsd": settings.MAX_DONATION_USD,
        "aiMode": settings.ai_mode,
        "currencies": [{"code": c, "symbol": m["symbol"], "decimals": m["decimals"], "rate": m["rate"],
                        "chips": m["chips"], "charge": m.get("charge", c)} for c, m in settings.CURRENCIES.items()],
        "monthlyTiers": settings.MONTHLY_TIERS_USD,
        "venmoEnabled": settings.ENABLE_VENMO,
        "needCategories": ai.NEED_CATEGORIES,
        "judgeDemo": settings.JUDGE_DEMO_LOGIN,
    }


def _public_name(d: Donation) -> str:
    return (d.display_name or "A kind donor") if d.show_on_leaderboard else "Anonymous"


@router.get("/stats")
def public_stats(session: Session = Depends(get_session)):
    f = funds(session)
    recent = session.exec(select(Donation).where(Donation.status == "COMPLETED")
                          .order_by(Donation.created_at.desc()).limit(6)).all()
    helped = session.exec(select(func.count(func.distinct(Payout.application_id)))
                          .where(Payout.status.in_(["SUCCESS", "UNCLAIMED", "PENDING"]))).one()
    return {**f, "familiesHelped": helped, "avgAidUsd": average_aid_usd(session),
            "recent": [{"name": _public_name(d), "amount": d.amount_usd,
                        "display": money_text(d.amount if d.amount is not None else d.amount_usd, d.currency),
                        "currency": d.currency or "USD", "monthly": bool(d.is_recurring), "at": iso(d.created_at)}
                       for d in recent]}


# ---------- one-time donations ----------
class CreateDonation(BaseModel):
    amount: float = Field(gt=0)
    currency: str = Field(default="USD", pattern="^[A-Z]{3}$")
    display_name: str = Field(default="", max_length=40)
    show_on_leaderboard: bool = False


def _clean_name(name: str) -> str | None:
    n = re.sub(r"[^\w .'\-]", "", name, flags=re.UNICODE).strip()[:40]
    return n or None


@router.post("/donations/create-order", dependencies=[Depends(rate_limit("donate", 20, 600))])
async def create_donation(body: CreateDonation, session: Session = Depends(get_session)):
    if body.currency not in settings.CURRENCIES:
        raise HTTPException(422, "That currency is not supported.")
    decimals = settings.CURRENCIES[body.currency]["decimals"]
    amount = round(body.amount, decimals)
    usd = to_usd(amount, body.currency)
    if usd < 1 or usd > settings.MAX_DONATION_USD:
        raise HTTPException(422, f"Donations must be between $1 and ${settings.MAX_DONATION_USD:,.0f} (USD value).")
    # Some currencies (INR) can't be received by a non-local PayPal account: charge the USD equivalent.
    charge_currency = settings.CURRENCIES[body.currency].get("charge", body.currency)
    charge_amount = amount if charge_currency == body.currency else usd
    try:
        order = await paypal.create_order(charge_amount, charge_currency, f"Donation - {settings.CAMPAIGN_NAME}")
    except paypal.PayPalError as e:
        raise HTTPException(502, str(e))
    session.add(Donation(paypal_order_id=order["id"], amount=amount, currency=body.currency, amount_usd=usd,
                         charge_currency=charge_currency, charge_amount=charge_amount,
                         display_name=_clean_name(body.display_name), show_on_leaderboard=body.show_on_leaderboard))
    session.commit()
    return {"id": order["id"]}


def _new_receipt(session: Session) -> str:
    while True:
        code = new_code("DN")
        if not session.exec(select(Donation).where(Donation.receipt_code == code)).first():
            return code


@router.post("/donations/{order_id}/capture", dependencies=[Depends(rate_limit("capture", 30, 600))])
async def capture_donation(order_id: str, session: Session = Depends(get_session)):
    if not ORDER_ID_RE.match(order_id):
        raise HTTPException(400, "Invalid order id")
    d = session.exec(select(Donation).where(Donation.paypal_order_id == order_id)).first()
    if not d:
        raise HTTPException(404, "Unknown order")
    if d.status in {"COMPLETED", "PENDING"}:
        return {"status": d.status, "amount": d.amount_usd, "receipt": d.receipt_code,
                "display": money_text(d.amount, d.currency)}
    try:
        result = await paypal.capture_order(order_id)
    except paypal.PayPalError as e:
        raise HTTPException(502, str(e))
    try:
        capture = result["purchase_units"][0]["payments"]["captures"][0]
        paid = float(capture["amount"]["value"])
        currency = capture["amount"]["currency_code"]
    except (KeyError, IndexError, ValueError):
        raise HTTPException(502, "Unexpected response from PayPal")
    # Never trust the browser: check what PayPal actually captured.
    expected_currency = d.charge_currency or d.currency or "USD"
    expected = d.charge_amount if d.charge_amount is not None else (d.amount if d.amount is not None else d.amount_usd)
    if (capture.get("status") not in {"COMPLETED", "PENDING"} or currency != expected_currency
            or abs(paid - expected) > 0.009):
        d.status = "FAILED"
        session.add(d)
        session.commit()
        raise HTTPException(402, "Payment was not completed.")
    # Use PayPal's real exchange rate if it converted the money.
    rate = (capture.get("seller_receivable_breakdown") or {}).get("exchange_rate") or {}
    if currency != "USD" and rate.get("target_currency") == "USD":
        try:
            d.amount_usd = round(paid * float(rate["value"]), 2)
        except (KeyError, ValueError):
            pass
    payer = result.get("payer") or {}
    d.status = capture["status"]  # COMPLETED, or PENDING (e.g. account must accept a new currency)
    d.paypal_capture_id = capture["id"]
    d.donor_name = (payer.get("name") or {}).get("given_name")
    d.payer_id = payer.get("payer_id")
    if not d.display_name and d.show_on_leaderboard:
        d.display_name = d.donor_name
    d.receipt_code = _new_receipt(session)
    session.add(d)
    session.commit()
    return {"status": d.status, "amount": d.amount_usd, "receipt": d.receipt_code,
            "display": money_text(d.amount, d.currency)}


# ---------- follow my dollar ----------
@router.get("/donations/receipt/{code}", dependencies=[Depends(rate_limit("receipt", 30, 600))])
async def receipt(code: str, session: Session = Depends(get_session)):
    code = code.strip().upper()
    d = session.exec(select(Donation).where(Donation.receipt_code == code)).first() if CODE_RE.match(code) else None
    if not d or d.status not in {"COMPLETED", "PENDING"}:
        raise HTTPException(404, "We couldn't find a donation with that receipt code.")
    slices = allocations(session).get(d.id, []) if d.status == "COMPLETED" else []
    used = round(sum(s["amount"] for s in slices), 2)
    towns = sorted({s["location"] for s in slices})
    families = len({s["applicationId"] for s in slices})
    display = money_text(d.amount if d.amount is not None else d.amount_usd, d.currency)
    note = await ai.thank_you_note(code, display, families, towns,
                                   d.display_name if d.show_on_leaderboard else None)
    return {
        "receipt": d.receipt_code, "status": d.status, "display": display, "amountUsd": d.amount_usd,
        "currency": d.currency or "USD", "monthly": bool(d.is_recurring), "at": iso(d.created_at),
        "usedUsd": used, "waitingUsd": round(max(d.amount_usd - used, 0), 2),
        "families": families, "towns": towns, "note": note,
        "slices": [{"location": s["location"], "amount": s["amount"], "at": s["at"], "status": s["status"]}
                   for s in slices],
    }


@router.get("/leaderboard")
def public_leaderboard(limit: int = 10, session: Session = Depends(get_session)):
    return leaderboard(session, limit=max(1, min(limit, 50)))


# ---------- monthly donations (PayPal Subscriptions) ----------
def _get_setting(session: Session, key: str) -> str | None:
    s = session.get(Setting, key)
    return s.value if s else None


def _set_setting(session: Session, key: str, value: str) -> None:
    s = session.get(Setting, key) or Setting(key=key, value=value)
    s.value = value
    session.add(s)
    session.commit()


async def _ensure_plans(session: Session) -> dict[str, str]:
    """Create the PayPal product + monthly plans once, then reuse them (ids saved in the database)."""
    cache_key = f"plans:{settings.PAYPAL_CLIENT_ID[:12]}:{','.join(map(str, settings.MONTHLY_TIERS_USD))}"
    saved = _get_setting(session, cache_key)
    if saved:
        return json.loads(saved)
    product = await paypal.create_product("ReliefPay Emergency Fund")
    plans = {}
    for tier in settings.MONTHLY_TIERS_USD:
        plans[str(tier)] = (await paypal.create_monthly_plan(product["id"], tier))["id"]
    _set_setting(session, cache_key, json.dumps(plans))
    return plans


@router.get("/subscriptions/plans", dependencies=[Depends(rate_limit("plans", 30, 600))])
async def subscription_plans(session: Session = Depends(get_session)):
    try:
        plans = await _ensure_plans(session)
    except paypal.PayPalError as e:
        raise HTTPException(502, f"Monthly giving is unavailable: {e}")
    return [{"amountUsd": int(k), "planId": v} for k, v in plans.items()]


class ConfirmSubscription(BaseModel):
    subscription_id: str = Field(min_length=5, max_length=40)
    display_name: str = Field(default="", max_length=40)
    show_on_leaderboard: bool = False


def _record_subscription_payment(session: Session, sub: Subscription, amount: float, key: str, when=None) -> Donation:
    d = session.exec(select(Donation).where(Donation.paypal_order_id == key)).first()
    if d:
        return d
    d = Donation(paypal_order_id=key, amount=amount, currency="USD", amount_usd=amount, status="COMPLETED",
                 is_recurring=True, subscription_id=sub.paypal_subscription_id, payer_id=sub.payer_id,
                 display_name=sub.display_name, show_on_leaderboard=sub.show_on_leaderboard,
                 receipt_code=_new_receipt(session), created_at=when or utcnow())
    session.add(d)
    session.commit()
    return d


@router.post("/subscriptions/confirm", dependencies=[Depends(rate_limit("subscribe", 10, 600))])
async def confirm_subscription(body: ConfirmSubscription, session: Session = Depends(get_session)):
    if not SUB_ID_RE.match(body.subscription_id):
        raise HTTPException(400, "Invalid subscription id")
    plans = {v: int(k) for k, v in (await _ensure_plans(session)).items()}
    try:
        data = await paypal.get_subscription(body.subscription_id)
    except paypal.PayPalError as e:
        raise HTTPException(502, str(e))
    if data.get("plan_id") not in plans or data.get("status") not in {"ACTIVE", "APPROVED"}:
        raise HTTPException(402, "This monthly donation is not active.")
    sub = session.exec(select(Subscription).where(Subscription.paypal_subscription_id == body.subscription_id)).first()
    if not sub:
        sub = Subscription(paypal_subscription_id=body.subscription_id, plan_id=data["plan_id"],
                           amount_usd=plans[data["plan_id"]], status=data["status"],
                           payer_id=(data.get("subscriber") or {}).get("payer_id"),
                           display_name=_clean_name(body.display_name), show_on_leaderboard=body.show_on_leaderboard)
        session.add(sub)
        session.commit()
    receipt_code = None
    last = (data.get("billing_info") or {}).get("last_payment")
    if last and last.get("amount"):
        d = _record_subscription_payment(session, sub, float(last["amount"]["value"]),
                                         f"SUB-{sub.paypal_subscription_id}-{last.get('time', 'first')}")
        receipt_code = d.receipt_code
    return {"status": sub.status, "amountUsd": sub.amount_usd, "receipt": receipt_code}


# ---------- applications ----------
def _clean(value: str, name: str, max_len: int, min_len: int = 1) -> str:
    v = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", value or "").strip()
    if len(v) < min_len:
        raise HTTPException(422, f"{name} is required.")
    if len(v) > max_len:
        raise HTTPException(422, f"{name} is too long (max {max_len} characters).")
    return v


@router.post("/applications", dependencies=[Depends(rate_limit("apply", 5, 900))])
async def submit_application(
    background: BackgroundTasks,
    full_name: str = Form(...),
    phone: str = Form(...),
    location: str = Form(...),
    household_size: int = Form(...),
    message: str = Form(...),
    consent: bool = Form(...),
    need_category: str = Form(""),
    payout_method: str = Form("PAYPAL"),
    paypal_email: str = Form(""),
    venmo_phone: str = Form(""),
    photo: UploadFile | None = File(None),
    session: Session = Depends(get_session),
):
    if not consent:
        raise HTTPException(422, "Please agree to the privacy notice to continue.")
    full_name = _clean(full_name, "Name", 80, 2)
    location = _clean(location, "Location", 80, 2)
    message = _clean(message, "Your message", 3000, 15)
    phone = _clean(phone, "Phone", 25, 7)
    if not re.fullmatch(r"[+\d][\d\s\-()]{6,24}", phone):
        raise HTTPException(422, "Please enter a valid phone number.")
    if not 1 <= household_size <= 30:
        raise HTTPException(422, "Household size must be between 1 and 30.")
    need = need_category.strip().lower()
    if need and need not in ai.NEED_CATEGORIES:
        raise HTTPException(422, "Please choose what the money is for.")
    method = payout_method.upper()
    venmo = None
    if method == "VENMO":
        if not settings.ENABLE_VENMO:
            raise HTTPException(422, "Venmo payouts are not available.")
        digits = re.sub(r"\D", "", venmo_phone)
        if len(digits) == 11 and digits.startswith("1"):
            digits = digits[1:]
        if len(digits) != 10:
            raise HTTPException(422, "Enter the 10-digit US mobile number linked to Venmo.")
        venmo, paypal_email = digits, ""
    elif method == "PAYPAL":
        try:
            paypal_email = validate_email(paypal_email.strip(), check_deliverability=False).normalized.lower()
        except EmailNotValidError:
            raise HTTPException(422, "Please enter a valid PayPal email.")
    else:
        raise HTTPException(422, "Choose PayPal or Venmo.")

    photo_file = photo_hash = None
    if photo is not None and photo.filename:
        data = await photo.read(6 * 1024 * 1024 + 1)
        try:
            photo_file, photo_hash, _ = process_upload(data)
        except BadImage as e:
            raise HTTPException(422, str(e))

    while True:
        ref = new_code("RP")
        if not session.exec(select(Application).where(Application.ref_code == ref)).first():
            break
    app = Application(ref_code=ref, full_name=full_name, phone=phone, paypal_email=paypal_email,
                      payout_method=method, venmo_phone=venmo, location=location, household_size=household_size,
                      need_category=need or None, raw_text=message, photo_file=photo_file, photo_hash=photo_hash)
    session.add(app)
    session.commit()
    session.refresh(app)
    background.add_task(run_triage, app.id)
    return {"ref": app.ref_code}


STATUS_TEXT = {
    "PENDING": "Received - our team is reviewing your request.",
    "APPROVED": "Approved - your payment is being prepared.",
    "REJECTED": "Not approved - please contact the relief desk if you think this is a mistake.",
    "PAID": "Paid - the money has been sent to your account.",
}
# Hand-written translations for the most common languages; others are translated by the AI.
STATUS_LOCAL = {
    "hi": {"PENDING": "आपका अनुरोध मिल गया है - हमारी टीम इसकी जाँच कर रही है।",
           "APPROVED": "स्वीकृत - आपका भुगतान तैयार किया जा रहा है।",
           "REJECTED": "स्वीकृत नहीं हुआ - अगर आपको लगता है कि यह गलती है, तो राहत केंद्र से संपर्क करें।",
           "PAID": "भुगतान हो गया - पैसे आपके खाते में भेज दिए गए हैं।"},
    "ta": {"PENDING": "உங்கள் கோரிக்கை பெறப்பட்டது - எங்கள் குழு அதைப் பரிசீலிக்கிறது.",
           "APPROVED": "ஒப்புதல் அளிக்கப்பட்டது - உங்கள் பணம் தயாராகிறது.",
           "REJECTED": "ஒப்புதல் அளிக்கப்படவில்லை - இது தவறு என்று நினைத்தால் நிவாரண மையத்தைத் தொடர்பு கொள்ளுங்கள்.",
           "PAID": "பணம் அனுப்பப்பட்டது - உங்கள் கணக்கிற்கு பணம் அனுப்பப்பட்டுவிட்டது."},
    "fil": {"PENDING": "Natanggap na - sinusuri ng aming team ang iyong kahilingan.",
            "APPROVED": "Aprubado na - inihahanda na ang iyong bayad.",
            "REJECTED": "Hindi naaprubahan - makipag-ugnayan sa relief desk kung sa tingin mo ay may mali.",
            "PAID": "Naipadala na - naipadala na ang pera sa iyong account."},
    "es": {"PENDING": "Recibida - nuestro equipo está revisando tu solicitud.",
           "APPROVED": "Aprobada - tu pago se está preparando.",
           "REJECTED": "No aprobada - contacta al centro de ayuda si crees que es un error.",
           "PAID": "Pagada - el dinero ha sido enviado a tu cuenta."},
}
LANG_CODES = {  # language name from the AI -> (UI code, speech code)
    "hindi": ("hi", "hi-IN"), "hindi (romanized)": ("hi", "hi-IN"), "tamil": ("ta", "ta-IN"),
    "tagalog": ("fil", "fil-PH"), "filipino": ("fil", "fil-PH"), "cebuano": ("fil", "fil-PH"),
    "waray": ("fil", "fil-PH"), "spanish": ("es", "es-ES"), "english": ("en", "en-US"),
    "bengali": ("bn", "bn-IN"), "telugu": ("te", "te-IN"), "malayalam": ("ml", "ml-IN"),
    "kannada": ("kn", "kn-IN"), "marathi": ("mr", "mr-IN"), "gujarati": ("gu", "gu-IN"),
    "urdu": ("ur", "ur-PK"), "indonesian": ("id", "id-ID"), "vietnamese": ("vi", "vi-VN"),
    "french": ("fr", "fr-FR"), "arabic": ("ar", "ar-SA"), "portuguese": ("pt", "pt-BR"),
}


@router.get("/applications/status", dependencies=[Depends(rate_limit("status", 15, 600))])
async def application_status(ref: str, phone_last4: str, session: Session = Depends(get_session)):
    ref = ref.strip().upper()
    app = session.exec(select(Application).where(Application.ref_code == ref)).first()
    # Same error for "wrong ref" and "wrong phone" so nobody can probe reference codes.
    if not app or re.sub(r"\D", "", app.phone)[-4:] != phone_last4.strip():
        raise HTTPException(404, "We couldn't find a request with those details.")
    english = STATUS_TEXT.get(app.status, "")
    local = None
    lang = (app.language or "").lower()
    code, speech = LANG_CODES.get(lang, (None, None))
    if code and code != "en":
        text = STATUS_LOCAL.get(code, {}).get(app.status) or await ai.translate(english, app.language)
        if text:
            local = {"language": app.language, "code": code, "speech": speech, "text": text}
    elif lang and not code and lang not in {"unknown", "english"}:
        text = await ai.translate(english, app.language)
        if text:
            local = {"language": app.language, "code": None, "speech": None, "text": text}
    return {"ref": app.ref_code, "status": app.status, "message": english, "local": local,
            "submittedAt": iso(app.created_at), "paidAt": iso(app.paid_at),
            "payoutMethod": app.payout_method or "PAYPAL",
            "amount": app.approved_amount_usd if app.status in {"APPROVED", "PAID"} else None}


# ---------- transparency ----------
@router.get("/transparency")
def transparency(session: Session = Depends(get_session)):
    f = funds(session)
    now = utcnow()
    days = [(now - timedelta(days=i)).date() for i in range(13, -1, -1)]
    series = {d.isoformat(): {"date": d.isoformat(), "in": 0.0, "out": 0.0} for d in days}
    for d in session.exec(select(Donation).where(Donation.status == "COMPLETED",
                                                 Donation.created_at >= now - timedelta(days=14))).all():
        key = d.created_at.date().isoformat()
        if key in series:
            series[key]["in"] += d.amount_usd
    payouts = session.exec(select(Payout, Application).join(Application, Payout.application_id == Application.id)
                           .where(Payout.status.in_(["SUCCESS", "UNCLAIMED", "PENDING"]))
                           .order_by(Payout.created_at.desc())).all()
    by_loc: dict[str, dict] = defaultdict(lambda: {"families": 0, "amount": 0.0})
    hours = []
    for p, a in payouts:
        key = p.created_at.date().isoformat()
        if key in series:
            series[key]["out"] += p.amount_usd
        by_loc[a.location]["families"] += 1
        by_loc[a.location]["amount"] += p.amount_usd
        hours.append((p.created_at - a.created_at).total_seconds() / 3600)
    blocked = session.exec(select(func.count(Application.id)).where(Application.fraud_risk == "high")).one()
    batches = session.exec(select(func.count(PayoutBatch.id))).one()
    currencies = session.exec(select(func.count(func.distinct(Donation.currency)))
                              .where(Donation.status == "COMPLETED")).one()

    # Town-level map points only (never individual homes).
    towns: dict[str, dict] = {}
    for a in session.exec(select(Application).where(Application.lat.is_not(None))).all():
        t = towns.setdefault(a.location, {"town": a.location, "lat": 0.0, "lng": 0.0, "n": 0,
                                          "requests": 0, "paid": 0})
        t["lat"] += a.lat
        t["lng"] += a.lng
        t["n"] += 1
        t["requests"] += 1
        t["paid"] += a.status == "PAID"
    points = [{"town": t["town"], "lat": round(t["lat"] / t["n"], 3), "lng": round(t["lng"] / t["n"], 3),
               "requests": t["requests"], "paid": t["paid"]} for t in towns.values()]
    return {
        **f,
        "familiesHelped": len({a.id for _, a in payouts}),
        "avgHoursToAid": round(sum(hours) / len(hours), 1) if hours else None,
        "fraudBlocked": blocked,
        "batches": batches,
        "currencies": currencies,
        "series": [{**v, "in": round(v["in"], 2), "out": round(v["out"], 2)} for v in series.values()],
        "byLocation": sorted(({"location": k, **{kk: round(vv, 2) for kk, vv in v.items()}}
                              for k, v in by_loc.items()), key=lambda x: -x["amount"]),
        "recentPayouts": [{"location": a.location, "amount": p.amount_usd, "at": iso(p.created_at),
                           "status": p.status, "method": p.method or "PAYPAL",
                           "purpose": p.purpose or a.need_category or "other"} for p, a in payouts[:12]],
        "map": points,
        "leaderboard": leaderboard(session),
    }


# ---------- PayPal webhooks ----------
PAYOUT_FAILED = {"FAILED", "RETURNED", "BLOCKED", "DENIED", "REFUNDED", "REVERSED"}


@router.post("/paypal/webhook", dependencies=[Depends(rate_limit("webhook", 120, 60))])
async def paypal_webhook(request: Request, session: Session = Depends(get_session)):
    raw = await request.body()
    if len(raw) > 200_000:
        raise HTTPException(413, "Too large")
    try:
        event = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "Invalid JSON")
    if not settings.PAYPAL_WEBHOOK_ID:
        raise HTTPException(503, "Webhooks are not configured (set PAYPAL_WEBHOOK_ID).")
    try:
        ok = await paypal.verify_webhook(dict(request.headers), event)
    except paypal.PayPalError as e:
        log.warning("Webhook verification error: %s", e)
        ok = False
    if not ok:
        raise HTTPException(401, "Signature verification failed")

    event_id, etype = str(event.get("id", "")), str(event.get("event_type", ""))
    if not event_id or session.exec(select(WebhookEvent).where(WebhookEvent.event_id == event_id)).first():
        return {"ok": True, "duplicate": True}
    res = event.get("resource") or {}

    if etype == "PAYMENT.CAPTURE.COMPLETED":
        d = session.exec(select(Donation).where(Donation.paypal_capture_id == res.get("id"))).first()
        if d and d.status == "PENDING":
            d.status = "COMPLETED"
            session.add(d)
    elif etype in {"PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"}:
        d = session.exec(select(Donation).where(Donation.paypal_capture_id == res.get("id"))).first()
        if d:
            d.status = "FAILED"
            session.add(d)
    elif etype.startswith("PAYMENT.PAYOUTS-ITEM."):
        sender_item = (res.get("payout_item") or {}).get("sender_item_id")
        p = session.exec(select(Payout).where(Payout.sender_item_id == sender_item)).first()
        if p:
            p.status = res.get("transaction_status", p.status)
            p.paypal_item_id = res.get("payout_item_id", p.paypal_item_id)
            session.add(p)
            if p.status in PAYOUT_FAILED:
                a = session.get(Application, p.application_id)
                a.status, a.paid_at = "APPROVED", None
                session.add(a)
    elif etype.startswith("PAYMENT.PAYOUTSBATCH."):
        bh = res.get("batch_header") or {}
        b = session.exec(select(PayoutBatch).where(PayoutBatch.paypal_batch_id == bh.get("payout_batch_id"))).first()
        if b:
            b.status = bh.get("batch_status", b.status)
            session.add(b)
    elif etype == "PAYMENT.SALE.COMPLETED" and res.get("billing_agreement_id"):
        sub = session.exec(select(Subscription).where(
            Subscription.paypal_subscription_id == res["billing_agreement_id"])).first()
        if sub:
            amount = float((res.get("amount") or {}).get("total", sub.amount_usd))
            # Skip if this cycle was already recorded at sign-up (within an hour).
            recent = session.exec(select(Donation).where(Donation.subscription_id == sub.paypal_subscription_id)
                                  .order_by(Donation.created_at.desc())).first()
            if not recent or (utcnow() - recent.created_at) > timedelta(hours=1):
                _record_subscription_payment(session, sub, amount, f"SUB-{sub.paypal_subscription_id}-{res.get('id')}")
    elif etype in {"BILLING.SUBSCRIPTION.CANCELLED", "BILLING.SUBSCRIPTION.SUSPENDED", "BILLING.SUBSCRIPTION.EXPIRED",
                   "BILLING.SUBSCRIPTION.ACTIVATED"}:
        sub = session.exec(select(Subscription).where(Subscription.paypal_subscription_id == res.get("id"))).first()
        if sub:
            sub.status = res.get("status", sub.status)
            session.add(sub)

    session.add(WebhookEvent(event_id=event_id, event_type=etype))
    session.commit()
    audit(None, "paypal-webhook", "webhook_" + etype.lower().replace(".", "_")[:40], event_id[:40])
    return {"ok": True}
