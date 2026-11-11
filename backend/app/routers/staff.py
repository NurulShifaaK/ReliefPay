"""Staff endpoints (login required). Reviewers decide; only admins can send money."""
import json
import secrets
from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, Field
from sqlmodel import Session, func, select

from .. import ai, paypal
from ..config import settings
from ..db import (AgentPlan, Application, AuditLog, Donation, FraudBlocklist, Payout, PayoutBatch, StaffUser,
                  Subscription, audit, get_session, utcnow, verify_audit_chain)
from ..fraud import _digits
from ..security import (authenticate, clear_session_cookie, client_ip, current_user, rate_limit,
                        require_role, set_session_cookie)
from ..services import (_recompute_flags, agent_tools, app_public, build_plan, funds, iso, money_text,
                        report_stats, run_triage)

router = APIRouter(prefix="/api/staff", tags=["staff"])
any_staff = require_role("admin", "reviewer")
admin_only = require_role("admin")


def _user(u: StaffUser) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role}


# ---------- auth ----------
class LoginBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


@router.post("/auth/login", dependencies=[Depends(rate_limit("login", 8, 300))])
def login(body: LoginBody, request: Request, response: Response, session: Session = Depends(get_session)):
    user = authenticate(session, body.email, body.password)
    if not user:
        audit(session, str(body.email), "login_failed", ip=client_ip(request))
        session.commit()
        raise HTTPException(401, "Wrong email or password")
    set_session_cookie(response, user)
    audit(session, user.email, "login", ip=client_ip(request))
    session.commit()
    return _user(user)


@router.post("/auth/demo", dependencies=[Depends(rate_limit("demo-login", 20, 300))])
def demo_login(request: Request, response: Response, session: Session = Depends(get_session)):
    """One-click sign-in for hackathon judges. Reviewer role only: can review, can never send money."""
    if not settings.JUDGE_DEMO_LOGIN:
        raise HTTPException(404, "Demo sign-in is turned off")
    user = session.exec(select(StaffUser).where(StaffUser.email == settings.REVIEWER_EMAIL.lower().strip())).first()
    if not user or user.role != "reviewer":
        raise HTTPException(404, "Demo sign-in is not available")
    set_session_cookie(response, user)
    audit(session, user.email, "login_demo", ip=client_ip(request))
    return _user(user)


@router.post("/auth/logout")
def logout(response: Response):
    clear_session_cookie(response)
    return {"ok": True}


@router.get("/auth/me")
def me(user: StaffUser = Depends(current_user)):
    return _user(user)


# ---------- dashboard ----------
@router.get("/dashboard")
def dashboard(user: StaffUser = Depends(any_staff), session: Session = Depends(get_session)):
    counts = dict(session.exec(select(Application.status, func.count(Application.id))
                               .group_by(Application.status)).all())
    high_risk = session.exec(select(func.count(Application.id)).where(
        Application.fraud_risk == "high", Application.status == "PENDING")).one()
    urgent = session.exec(select(Application).where(Application.status == "PENDING")
                          .order_by(Application.urgency_score.desc()).limit(5)).all()
    now = utcnow()
    days = [(now - timedelta(days=i)).date() for i in range(6, -1, -1)]
    series = {d.isoformat(): {"date": d.isoformat(), "in": 0.0, "out": 0.0} for d in days}
    for d in session.exec(select(Donation).where(Donation.status == "COMPLETED",
                                                 Donation.created_at >= now - timedelta(days=7))).all():
        k = d.created_at.date().isoformat()
        if k in series:
            series[k]["in"] += d.amount_usd
    for p in session.exec(select(Payout).where(Payout.created_at >= now - timedelta(days=7))).all():
        k = p.created_at.date().isoformat()
        if k in series:
            series[k]["out"] += p.amount_usd
    activity = session.exec(select(AuditLog).where(AuditLog.action != "login_failed")
                            .order_by(AuditLog.created_at.desc()).limit(8)).all()
    return {
        "funds": funds(session),
        "counts": {s: counts.get(s, 0) for s in ["PENDING", "APPROVED", "REJECTED", "PAID"]},
        "highRiskPending": high_risk,
        "urgent": [app_public(a) for a in urgent],
        "series": list(series.values()),
        "activity": [{"actor": a.actor, "action": a.action, "target": a.target, "at": iso(a.created_at)}
                     for a in activity],
        "aiMode": settings.ai_mode,
        "aiError": ai.last_error["message"],
        "paypalReady": paypal.configured(),
    }


# ---------- applications ----------
@router.get("/applications")
def list_applications(status: str | None = None, risk: str | None = None, q: str | None = None,
                      user: StaffUser = Depends(any_staff), session: Session = Depends(get_session)):
    stmt = select(Application)
    if status:
        stmt = stmt.where(Application.status == status.upper())
    if risk:
        stmt = stmt.where(Application.fraud_risk == risk.lower())
    apps = session.exec(stmt).all()
    if q:
        ql = q.lower()[:80]
        apps = [a for a in apps if ql in f"{a.ref_code} {a.full_name} {a.location} {a.paypal_email}".lower()]
    # New requests (AI still reading) first, then pending by urgency, then the rest (newest first)
    apps.sort(key=lambda a: (a.ai_status == "DONE", a.status != "PENDING", -(a.urgency_score or 0),
                             -a.created_at.timestamp()))
    return [app_public(a) for a in apps]


def _get_app(session: Session, app_id: int) -> Application:
    app = session.get(Application, app_id)
    if not app:
        raise HTTPException(404, "Application not found")
    return app


@router.get("/applications/{app_id}")
def get_application(app_id: int, user: StaffUser = Depends(any_staff), session: Session = Depends(get_session)):
    return app_public(_get_app(session, app_id))


@router.get("/applications/{app_id}/photo")
def get_photo(app_id: int, user: StaffUser = Depends(any_staff), session: Session = Depends(get_session)):
    app = _get_app(session, app_id)
    if not app.photo_file:
        raise HTTPException(404, "No photo")
    path = (settings.upload_dir / app.photo_file).resolve()
    if path.parent != settings.upload_dir.resolve() or not path.is_file():  # path traversal guard
        raise HTTPException(404, "No photo")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=300"})


class DecisionBody(BaseModel):
    decision: str = Field(pattern="^(APPROVE|REJECT)$")
    amount_usd: float | None = Field(default=None, gt=0)
    note: str = Field(default="", max_length=500)


@router.post("/applications/{app_id}/decision")
def decide(app_id: int, body: DecisionBody, request: Request,
           user: StaffUser = Depends(any_staff), session: Session = Depends(get_session)):
    app = _get_app(session, app_id)
    if app.status == "PAID":
        raise HTTPException(409, "This family has already been paid.")
    if app.marked_fraud:
        raise HTTPException(409, "This request is marked as fraud. An admin must unmark it first.")
    if body.decision == "APPROVE":
        if app.ai_status != "DONE":
            raise HTTPException(409, "Wait for the AI review to finish first.")
        if app.fraud_risk == "high" and len(body.note.strip()) < 10:
            raise HTTPException(422, "High fraud risk: write a note (10+ characters) explaining why you approve.")
        amount = round(body.amount_usd or app.suggested_amount_usd or 0, 2)
        if not 0 < amount <= settings.MAX_PAYOUT_PER_FAMILY_USD:
            raise HTTPException(422, f"Amount must be between $1 and ${settings.MAX_PAYOUT_PER_FAMILY_USD:,.0f}.")
        app.status, app.approved_amount_usd = "APPROVED", amount
    else:
        app.status, app.approved_amount_usd = "REJECTED", None
    app.decision_note = body.note.strip() or None
    app.decided_by, app.decided_at = user.name, utcnow()
    session.add(app)
    session.commit()
    audit(session, user.email, f"application_{body.decision.lower()}d", app.ref_code,
          f"${app.approved_amount_usd}" if app.approved_amount_usd else body.note[:120], client_ip(request))
    return app_public(app)


@router.post("/applications/{app_id}/retriage")
def retriage(app_id: int, background: BackgroundTasks, user: StaffUser = Depends(any_staff),
             session: Session = Depends(get_session)):
    app = _get_app(session, app_id)
    app.ai_status = "QUEUED"
    session.add(app)
    session.commit()
    background.add_task(run_triage, app.id)
    return {"ok": True}


# ---------- photo evidence: AI labels objects and checks the photo against the story ----------
SUSPECT_PHOTO = {"screenshot": "looks like a screenshot", "stock_or_downloaded": "looks like a stock / downloaded image",
                 "ai_generated": "may be AI-generated"}


@router.post("/applications/{app_id}/analyze-photo", dependencies=[Depends(rate_limit("photo-ai", 20, 300))])
async def analyze_photo(app_id: int, force: bool = False, user: StaffUser = Depends(any_staff),
                        session: Session = Depends(get_session)):
    app = _get_app(session, app_id)
    if not app.photo_file:
        raise HTTPException(404, "This request has no photo.")
    if app.photo_analysis and not force:
        return json.loads(app.photo_analysis)
    path = (settings.upload_dir / app.photo_file).resolve()
    if path.parent != settings.upload_dir.resolve() or not path.is_file():
        raise HTTPException(404, "Photo file is missing.")
    try:
        result, provider = await ai.analyze_photo(path.read_bytes(), app.raw_text, app.location)
    except ai.AIError as e:
        raise HTTPException(503, ai.last_error["message"] or str(e))
    result.update({"provider": provider, "at": iso(utcnow())})
    app.photo_analysis = json.dumps(result)
    # Photo problems become fraud signals (warnings, never an automatic rejection)
    flags = [f for f in app.flags() if not f.startswith("AI: Photo")]
    if result["authenticity"] in SUSPECT_PHOTO:
        flags.append(f"AI: Photo {SUSPECT_PHOTO[result['authenticity']]}")
    if result["storyMatch"] < 35:
        flags.append(f"AI: Photo does not support the story (match {result['storyMatch']}/100)")
    app.fraud_flags = json.dumps(flags)
    _recompute_flags(session, app)
    session.add(app)
    session.commit()
    audit(session, user.email, "photo_analysed", app.ref_code, f"match {result['storyMatch']}/100")
    return result


# ---------- mark as fraud (+ blocklist so the same person is flagged next time) ----------
class FraudBody(BaseModel):
    reason: str = Field(min_length=10, max_length=300)


def _recompute_all(session: Session) -> None:
    for a in session.exec(select(Application).where(Application.ai_status == "DONE")).all():
        _recompute_flags(session, a)
        session.add(a)


@router.post("/applications/{app_id}/mark-fraud")
def mark_fraud(app_id: int, body: FraudBody, request: Request, user: StaffUser = Depends(any_staff),
               session: Session = Depends(get_session)):
    app = _get_app(session, app_id)
    if app.marked_fraud:
        raise HTTPException(409, "Already marked as fraud.")
    app.marked_fraud, app.fraud_reason = True, body.reason.strip()
    app.marked_by, app.marked_at = user.name, utcnow()
    if app.status != "PAID":
        app.status, app.approved_amount_usd = "REJECTED", None
        app.decided_by, app.decided_at, app.decision_note = user.name, utcnow(), "Marked as fraud"
    session.add(app)
    session.add(FraudBlocklist(application_ref=app.ref_code, phone_digits=_digits(app.phone) or None,
                               paypal_email=(app.paypal_email or "").lower() or None, venmo_phone=app.venmo_phone,
                               photo_hash=app.photo_hash, reason=body.reason.strip()))
    session.flush()
    _recompute_all(session)
    session.commit()
    audit(session, user.email, "marked_fraud", app.ref_code, body.reason[:120], client_ip(request))
    return app_public(app)


@router.post("/applications/{app_id}/unmark-fraud")
def unmark_fraud(app_id: int, request: Request, user: StaffUser = Depends(admin_only),
                 session: Session = Depends(get_session)):
    app = _get_app(session, app_id)
    if not app.marked_fraud:
        raise HTTPException(409, "This request is not marked as fraud.")
    for row in session.exec(select(FraudBlocklist).where(FraudBlocklist.application_ref == app.ref_code)).all():
        session.delete(row)
    app.marked_fraud, app.fraud_reason, app.marked_by, app.marked_at = False, None, None, None
    if app.status == "REJECTED":
        app.status, app.decision_note = "PENDING", None
    session.add(app)
    session.flush()
    _recompute_all(session)
    session.commit()
    audit(session, user.email, "unmarked_fraud", app.ref_code, ip=client_ip(request))
    return app_public(app)


# ---------- pay ONE family directly (admin) ----------
_paying: set[int] = set()   # applications with a payment in flight (blocks double clicks)


def _pay_check(session: Session, app: Application, user: StaffUser) -> dict:
    f = funds(session)
    amount = app.approved_amount_usd or app.suggested_amount_usd or 0
    photo = json.loads(app.photo_analysis) if app.photo_analysis else None
    disaster_ok = app.disaster_status in {"confirmed", "not_claimed"}
    checks = [
        {"key": "approved", "ok": app.status == "APPROVED", "level": "block",
         "text": "Approved by a reviewer" if app.status == "APPROVED" else f"Status is {app.status.lower()}, not approved"},
        {"key": "fraud", "ok": app.fraud_risk != "high" and not app.marked_fraud, "level": "block",
         "text": {"low": "Low fraud risk", "medium": "Medium fraud risk: read the signals first",
                  "high": "High fraud risk: cannot be paid"}[app.fraud_risk] if not app.marked_fraud
         else "Marked as fraud: cannot be paid", "warn": app.fraud_risk == "medium"},
        {"key": "disaster", "ok": disaster_ok, "level": "reason",
         "text": {"confirmed": "Disaster confirmed by outside sources",
                  "not_claimed": f"Non-disaster request ({app.need_category or 'other'})",
                  "not_found": f"No recent {app.claimed_event or 'disaster'} found in {app.location}: a written reason is required",
                  }.get(app.disaster_status or "", "Disaster could not be checked"),
         "warn": app.disaster_status in {None, "unknown"}},
        {"key": "photo", "ok": bool(photo and photo["storyMatch"] >= 35), "level": "info",
         "text": (f"Photo supports the story ({photo['storyMatch']}/100)" if photo and photo["storyMatch"] >= 35
                  else f"Photo does not support the story ({photo['storyMatch']}/100)" if photo
                  else "Photo not analysed yet" if app.photo_file else "No photo was sent"),
         "warn": not photo},
        {"key": "receiver", "ok": bool(app.receiver), "level": "block",
         "text": f"Pays to {'Venmo ' if app.payout_method == 'VENMO' else ''}{app.receiver}" if app.receiver
         else "No payout account"},
        {"key": "funds", "ok": f["availableUsd"] >= amount > 0, "level": "block",
         "text": f"${f['availableUsd']:,.2f} available" if f["availableUsd"] >= amount
         else f"Only ${f['availableUsd']:,.2f} available (needs ${amount:,.2f})"},
        {"key": "paypal", "ok": paypal.configured(), "level": "block",
         "text": "PayPal connected" if paypal.configured() else "PayPal is not configured"},
    ]
    blocked = [c["text"] for c in checks if c["level"] == "block" and not c["ok"]]
    return {
        "checks": checks, "blockers": blocked, "canPay": not blocked and user.role == "admin",
        "isAdmin": user.role == "admin",
        "needsReason": bool(app.claims_disaster and app.disaster_status == "not_found"),
        "amountUsd": amount, "capUsd": settings.MAX_PAYOUT_PER_FAMILY_USD, "availableUsd": f["availableUsd"],
        "purpose": app.need_category or "other", "receiver": app.receiver, "method": app.payout_method or "PAYPAL",
    }


@router.get("/applications/{app_id}/pay-check")
def pay_check(app_id: int, user: StaffUser = Depends(any_staff), session: Session = Depends(get_session)):
    return _pay_check(session, _get_app(session, app_id), user)


class PayBody(BaseModel):
    amount_usd: float = Field(gt=0)
    purpose: str = Field(default="", max_length=20)
    note: str = Field(default="", max_length=300)
    reason_unverified: str = Field(default="", max_length=300)


@router.post("/applications/{app_id}/pay", dependencies=[Depends(rate_limit("pay-one", 20, 600))])
async def pay_one(app_id: int, body: PayBody, request: Request, user: StaffUser = Depends(admin_only),
                  session: Session = Depends(get_session)):
    if app_id in _paying:
        raise HTTPException(409, "A payment for this family is already being sent.")
    _paying.add(app_id)
    try:
        app = _get_app(session, app_id)
        check = _pay_check(session, app, user)
        if check["blockers"]:
            raise HTTPException(409, check["blockers"][0])
        amount = round(body.amount_usd, 2)
        if amount > settings.MAX_PAYOUT_PER_FAMILY_USD:
            raise HTTPException(422, f"The limit is ${settings.MAX_PAYOUT_PER_FAMILY_USD:,.0f} per family.")
        if amount > check["availableUsd"] + 1e-9:
            raise HTTPException(422, f"Only ${check['availableUsd']:,.2f} is available.")
        if check["needsReason"] and len(body.reason_unverified.strip()) < 10:
            raise HTTPException(422, "The disaster was not confirmed. Write why you are paying anyway (10+ characters).")
        purpose = body.purpose.lower() if body.purpose.lower() in ai.NEED_CATEGORIES else (app.need_category or "other")

        attempts = session.exec(select(func.count(PayoutBatch.id)).where(
            PayoutBatch.sender_batch_id.startswith(f"RP-ONE-{app.ref_code}-"))).one()
        sender_batch_id = f"RP-ONE-{app.ref_code}-{attempts + 1}"
        batch = PayoutBatch(sender_batch_id=sender_batch_id, total_usd=amount, created_by=user.name,
                            instruction=f"Direct payment to {app.ref_code} ({purpose})"
                            + (f" - {body.note.strip()}" if body.note.strip() else ""))
        session.add(batch)
        session.commit()
        session.refresh(batch)
        item = {"receiver": app.receiver, "method": app.payout_method or "PAYPAL", "amount_usd": amount,
                "sender_item_id": f"{sender_batch_id}-{app.id}",
                "note": f"Emergency relief for {purpose} ({app.ref_code})"}
        try:
            result = await paypal.create_payout_batch(sender_batch_id, [item])
        except paypal.PayPalError as e:
            batch.status = "FAILED"
            session.add(batch)
            session.commit()
            audit(session, user.email, "payout_failed", sender_batch_id, str(e)[:200], client_ip(request))
            raise HTTPException(502, str(e))

        batch.paypal_batch_id = result["batch_header"]["payout_batch_id"]
        batch.status = result["batch_header"].get("batch_status", "PENDING")
        session.add(Payout(batch_id=batch.id, application_id=app.id, sender_item_id=item["sender_item_id"],
                           receiver=app.receiver, method=item["method"], purpose=purpose, amount_usd=amount))
        app.status, app.paid_at, app.approved_amount_usd = "PAID", utcnow(), amount
        session.add(app)
        session.add(batch)
        session.commit()
        detail = f"${amount} for {purpose}"
        if check["needsReason"]:
            detail += f" | disaster not confirmed, reason: {body.reason_unverified.strip()[:120]}"
        audit(session, user.email, "payout_sent_single", app.ref_code, detail, client_ip(request))
        return {"batchId": batch.id, "paypalBatchId": batch.paypal_batch_id, "status": batch.status,
                "amountUsd": amount, "application": app_public(app)}
    finally:
        _paying.discard(app_id)


# ---------- payout agent ----------
class ChatTurn(BaseModel):
    role: str = Field(pattern="^(user|agent)$")
    text: str = Field(max_length=500)


class PlanBody(BaseModel):
    instruction: str = Field(min_length=2, max_length=500)
    history: list[ChatTurn] = Field(default_factory=list, max_length=10)


@router.post("/agent/plan", dependencies=[Depends(rate_limit("agent", 20, 300))])
async def agent_plan(body: PlanBody, user: StaffUser = Depends(any_staff), session: Session = Depends(get_session)):
    locations = sorted(set(session.exec(select(Application.location)).all()))
    result = await ai.run_payout_agent(body.instruction, [h.model_dump() for h in body.history],
                                       agent_tools(session), locations)
    if result["kind"] == "clarify":
        audit(session, user.email, "agent_clarify", None, result["question"][:120])
        return {"kind": "clarify", "question": result["question"], "steps": result["steps"],
                "provider": result["provider"]}
    filters = result["filters"]
    plan = build_plan(session, filters)
    token = secrets.token_urlsafe(24)
    session.add(AgentPlan(token=token, instruction=body.instruction, filters=json.dumps(filters),
                          items=json.dumps(plan["items"]), total_usd=plan["total_usd"],
                          created_by=user.email, expires_at=utcnow() + timedelta(minutes=10)))
    session.commit()
    audit(session, user.email, "agent_plan", None, f"{len(plan['items'])} families, ${plan['total_usd']}")
    return {"kind": "plan", "token": token, "filters": filters, "provider": result["provider"],
            "steps": result["steps"], **plan, "canExecute": user.role == "admin", "paypalReady": paypal.configured()}


class ExecuteBody(BaseModel):
    token: str = Field(min_length=10, max_length=100)


@router.post("/agent/execute", dependencies=[Depends(rate_limit("payout", 10, 600))])
async def agent_execute(body: ExecuteBody, request: Request, user: StaffUser = Depends(admin_only),
                        session: Session = Depends(get_session)):
    plan = session.exec(select(AgentPlan).where(AgentPlan.token == body.token)).first()
    if not plan or plan.used:
        raise HTTPException(404, "This plan was already used or doesn't exist. Create a new one.")
    if plan.expires_at < utcnow():
        raise HTTPException(410, "This plan expired (10 minutes). Create a new one.")
    items = json.loads(plan.items)
    if not items:
        raise HTTPException(422, "Nothing to pay in this plan.")

    # Re-check everything right before money moves (state may have changed).
    total = 0.0
    for it in items:
        app = session.get(Application, it["application_id"])
        if not app or app.status != "APPROVED" or app.fraud_risk == "high":
            raise HTTPException(409, f"{it['ref']} is no longer eligible. Create a new plan.")
        if it["amount_usd"] > settings.MAX_PAYOUT_PER_FAMILY_USD:
            raise HTTPException(422, "Amount above the per-family limit.")
        total += it["amount_usd"]
    if total > min(settings.MAX_BATCH_TOTAL_USD, funds(session)["availableUsd"]) + 1e-9:
        raise HTTPException(422, "Not enough available funds for this batch.")

    plan.used = True
    sender_batch_id = f"RP-{utcnow():%Y%m%d%H%M%S}-{secrets.token_hex(4)}"
    batch = PayoutBatch(sender_batch_id=sender_batch_id, total_usd=round(total, 2),
                        instruction=plan.instruction, created_by=user.name)
    session.add(batch)
    session.add(plan)
    session.commit()
    session.refresh(batch)

    pp_items = [{"receiver": it["receiver"], "method": it.get("method", "PAYPAL"), "amount_usd": it["amount_usd"],
                 "sender_item_id": f"{sender_batch_id}-{it['application_id']}",
                 "note": f"Emergency relief ({it['ref']})"} for it in items]
    try:
        result = await paypal.create_payout_batch(sender_batch_id, pp_items)
    except paypal.PayPalError as e:
        batch.status = "FAILED"
        session.add(batch)
        session.commit()
        audit(session, user.email, "payout_failed", sender_batch_id, str(e)[:200], client_ip(request))
        raise HTTPException(502, str(e))

    batch.paypal_batch_id = result["batch_header"]["payout_batch_id"]
    batch.status = result["batch_header"].get("batch_status", "PENDING")
    now = utcnow()
    for it, pp in zip(items, pp_items):
        session.add(Payout(batch_id=batch.id, application_id=it["application_id"],
                           sender_item_id=pp["sender_item_id"], receiver=it["receiver"],
                           method=pp["method"], purpose=it.get("need"), amount_usd=it["amount_usd"]))
        app = session.get(Application, it["application_id"])
        app.status, app.paid_at = "PAID", now
        session.add(app)
    session.add(batch)
    session.commit()
    audit(session, user.email, "payout_sent", sender_batch_id,
          f"{len(items)} families, ${batch.total_usd}", client_ip(request))
    return {"batchId": batch.id, "paypalBatchId": batch.paypal_batch_id, "status": batch.status,
            "families": len(items), "totalUsd": batch.total_usd}


# ---------- payouts ----------
@router.get("/payouts")
def list_payouts(user: StaffUser = Depends(any_staff), session: Session = Depends(get_session)):
    batches = session.exec(select(PayoutBatch).order_by(PayoutBatch.created_at.desc())).all()
    out = []
    for b in batches:
        rows = session.exec(select(Payout, Application).join(Application, Payout.application_id == Application.id)
                            .where(Payout.batch_id == b.id)).all()
        out.append({"id": b.id, "paypalBatchId": b.paypal_batch_id, "status": b.status, "totalUsd": b.total_usd,
                    "instruction": b.instruction, "createdBy": b.created_by, "createdAt": iso(b.created_at),
                    "items": [{"ref": a.ref_code, "name": a.full_name, "location": a.location,
                               "receiver": p.receiver, "amount": p.amount_usd, "status": p.status}
                              for p, a in rows]})
    return out


@router.post("/payouts/{batch_id}/sync")
async def sync_payout(batch_id: int, user: StaffUser = Depends(any_staff), session: Session = Depends(get_session)):
    batch = session.get(PayoutBatch, batch_id)
    if not batch or not batch.paypal_batch_id:
        raise HTTPException(404, "Batch not found")
    try:
        data = await paypal.get_payout_batch(batch.paypal_batch_id)
    except paypal.PayPalError as e:
        raise HTTPException(502, str(e))
    batch.status = data["batch_header"].get("batch_status", batch.status)
    by_sender = {i.get("payout_item", {}).get("sender_item_id"): i for i in data.get("items", [])}
    for p in session.exec(select(Payout).where(Payout.batch_id == batch.id)).all():
        item = by_sender.get(p.sender_item_id)
        if item:
            p.status = item.get("transaction_status", p.status)
            p.paypal_item_id = item.get("payout_item_id")
            session.add(p)
            if p.status in {"FAILED", "RETURNED", "BLOCKED", "DENIED", "REFUNDED", "REVERSED"}:
                app = session.get(Application, p.application_id)
                app.status, app.paid_at = "APPROVED", None   # back in the queue to retry
                session.add(app)
    session.add(batch)
    session.commit()
    return {"status": batch.status}


# ---------- donations + audit ----------
@router.get("/donations")
def list_donations(user: StaffUser = Depends(any_staff), session: Session = Depends(get_session)):
    rows = session.exec(select(Donation).order_by(Donation.created_at.desc()).limit(500)).all()
    subs = session.exec(select(func.count(Subscription.id)).where(Subscription.status == "ACTIVE")).one()
    return {"activeMonthly": subs, "rows": [{
        "id": d.id, "orderId": d.paypal_order_id, "captureId": d.paypal_capture_id, "amount": d.amount_usd,
        "display": money_text(d.amount if d.amount is not None else d.amount_usd, d.currency),
        "currency": d.currency or "USD", "donor": d.donor_name, "displayName": d.display_name,
        "public": bool(d.show_on_leaderboard), "monthly": bool(d.is_recurring), "receipt": d.receipt_code,
        "status": d.status, "isSeed": d.is_seed, "at": iso(d.created_at)} for d in rows]}


# ---------- map + AI situation report ----------
@router.get("/map")
def staff_map(user: StaffUser = Depends(any_staff), session: Session = Depends(get_session)):
    rows = session.exec(select(Application).where(Application.lat.is_not(None))).all()
    return [{"id": a.id, "ref": a.ref_code, "name": a.full_name, "location": a.location, "lat": a.lat, "lng": a.lng,
             "urgency": a.urgency_score, "status": a.status, "risk": a.fraud_risk} for a in rows]


@router.post("/report", dependencies=[Depends(rate_limit("report", 10, 300))])
async def situation_report(user: StaffUser = Depends(any_staff), session: Session = Depends(get_session)):
    stats = report_stats(session)
    report, provider = await ai.situation_report(stats)
    audit(session, user.email, "ai_report")
    return {**report, "provider": provider, "stats": stats, "at": iso(utcnow())}


# ---------- audit ----------
@router.get("/audit")
def list_audit(user: StaffUser = Depends(admin_only), session: Session = Depends(get_session)):
    rows = session.exec(select(AuditLog).order_by(AuditLog.id.desc()).limit(300)).all()
    return [{"id": a.id, "actor": a.actor, "action": a.action, "target": a.target, "detail": a.detail,
             "ip": a.ip, "hash": (a.hash or "")[:12], "at": iso(a.created_at)} for a in rows]


@router.get("/audit/verify")
def audit_verify(user: StaffUser = Depends(admin_only), session: Session = Depends(get_session)):
    return verify_audit_chain(session)
