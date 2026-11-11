"""Database models. SQLite by default: one file at data/reliefpay.db, nothing to install."""
import hashlib
import json
import logging
from datetime import datetime, timezone
from threading import Lock
from typing import Optional

from sqlalchemy import event, inspect, text
from sqlmodel import Field, Session, SQLModel, create_engine, select

from .config import settings

engine = create_engine(settings.db_url, connect_args={"check_same_thread": False, "timeout": 15})
log = logging.getLogger("reliefpay.db")


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")   # safe concurrent reads
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class StaffUser(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    name: str
    role: str  # "admin" (can send money) | "reviewer" (can approve/reject)
    password_hash: str
    created_at: datetime = Field(default_factory=utcnow)


class Donation(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    paypal_order_id: str = Field(index=True, unique=True)
    paypal_capture_id: Optional[str] = Field(default=None, index=True)
    amount_usd: float                       # value in USD (base currency for all totals)
    currency: Optional[str] = "USD"         # what the donor chose (shown on receipts / donor wall)
    amount: Optional[float] = None          # amount in that currency
    charge_currency: Optional[str] = None   # what PayPal actually charged (differs for INR -> USD)
    charge_amount: Optional[float] = None
    donor_name: Optional[str] = None        # from PayPal (private)
    display_name: Optional[str] = None      # chosen by donor for the leaderboard
    show_on_leaderboard: Optional[bool] = False
    payer_id: Optional[str] = Field(default=None, index=True)
    receipt_code: Optional[str] = Field(default=None, index=True)
    is_recurring: Optional[bool] = False
    subscription_id: Optional[str] = Field(default=None, index=True)
    status: str = "CREATED"  # CREATED -> COMPLETED / PENDING / FAILED
    is_seed: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class Application(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    ref_code: str = Field(index=True, unique=True)
    full_name: str
    phone: str = Field(index=True)
    paypal_email: str = Field(default="", index=True)
    payout_method: Optional[str] = "PAYPAL"  # PAYPAL | VENMO
    venmo_phone: Optional[str] = None
    location: str = Field(index=True)
    lat: Optional[float] = None
    lng: Optional[float] = None
    household_size: int = 1
    need_category: Optional[str] = None      # applicant's choice: food|shelter|medical|education|livelihood|other
    raw_text: str
    photo_file: Optional[str] = None
    photo_hash: Optional[str] = None
    photo_analysis: Optional[str] = None     # JSON: AI-labelled objects with boxes + story match
    # --- AI results ---
    ai_status: str = "QUEUED"  # QUEUED -> DONE / ERROR
    ai_provider: Optional[str] = None
    ai_error: Optional[str] = None           # why the AI was unavailable (shown to staff)
    language: Optional[str] = None
    summary_en: Optional[str] = None
    damage_level: Optional[str] = None       # none | minor | moderate | severe
    vulnerabilities: str = "[]"              # JSON list
    urgency_score: Optional[int] = None      # 0-100
    urgency_reason: Optional[str] = None
    suggested_amount_usd: Optional[float] = None
    photo_assessment: Optional[str] = None
    fraud_flags: str = "[]"                  # JSON list
    fraud_risk: str = "low"                  # low | medium | high
    # --- Disaster verification ---
    claims_disaster: Optional[bool] = None   # does the applicant say a disaster hit them?
    claimed_event: Optional[str] = None      # flood | typhoon | earthquake ...
    disaster_status: Optional[str] = None    # confirmed | not_found | unknown | not_claimed
    disaster_check: Optional[str] = None     # JSON with events + news sources
    # --- Marked as fraud by staff ---
    marked_fraud: Optional[bool] = False
    fraud_reason: Optional[str] = None
    marked_by: Optional[str] = None
    marked_at: Optional[datetime] = None
    # --- Human decision ---
    status: str = Field(default="PENDING", index=True)  # PENDING|APPROVED|REJECTED|PAID
    approved_amount_usd: Optional[float] = None
    decision_note: Optional[str] = None
    decided_by: Optional[str] = None
    decided_at: Optional[datetime] = None
    paid_at: Optional[datetime] = None
    is_seed: bool = False
    created_at: datetime = Field(default_factory=utcnow)

    def flags(self) -> list[str]:
        return json.loads(self.fraud_flags or "[]")

    def vulns(self) -> list[str]:
        return json.loads(self.vulnerabilities or "[]")

    @property
    def receiver(self) -> str:
        return self.venmo_phone if self.payout_method == "VENMO" else self.paypal_email


class PayoutBatch(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    sender_batch_id: str = Field(unique=True)
    paypal_batch_id: Optional[str] = Field(default=None, index=True)
    status: str = "CREATED"
    total_usd: float
    instruction: str
    created_by: str
    created_at: datetime = Field(default_factory=utcnow)


class Payout(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    batch_id: int = Field(foreign_key="payoutbatch.id", index=True)
    application_id: int = Field(foreign_key="application.id", index=True)
    sender_item_id: str = Field(unique=True)
    paypal_item_id: Optional[str] = None
    receiver: str
    method: Optional[str] = "PAYPAL"
    purpose: Optional[str] = None           # food|shelter|medical|education|livelihood|other
    amount_usd: float
    status: str = "PENDING"  # PayPal transaction_status: SUCCESS, UNCLAIMED, PENDING, FAILED...
    created_at: datetime = Field(default_factory=utcnow)


class AgentPlan(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    token: str = Field(index=True, unique=True)
    instruction: str
    filters: str          # JSON
    items: str            # JSON list of {application_id, amount}
    total_usd: float
    created_by: str
    expires_at: datetime
    used: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class Subscription(SQLModel, table=True):
    """A monthly donation (PayPal Subscriptions)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    paypal_subscription_id: str = Field(unique=True)
    plan_id: str
    amount_usd: float
    status: str
    payer_id: Optional[str] = None
    display_name: Optional[str] = None
    show_on_leaderboard: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class WebhookEvent(SQLModel, table=True):
    """Processed PayPal webhook ids, so a replayed event is never applied twice."""
    id: Optional[int] = Field(default=None, primary_key=True)
    event_id: str = Field(unique=True)
    event_type: str
    received_at: datetime = Field(default_factory=utcnow)


class FraudBlocklist(SQLModel, table=True):
    """Identifiers of applicants that staff marked as fraud; new applications are checked against it."""
    id: Optional[int] = Field(default=None, primary_key=True)
    application_ref: str = Field(index=True)
    phone_digits: Optional[str] = Field(default=None, index=True)
    paypal_email: Optional[str] = Field(default=None, index=True)
    venmo_phone: Optional[str] = None
    photo_hash: Optional[str] = None
    reason: str = ""
    created_at: datetime = Field(default_factory=utcnow)


class Setting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str


class AuditLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    actor: str
    action: str
    target: Optional[str] = None
    detail: Optional[str] = None
    ip: Optional[str] = None
    prev_hash: Optional[str] = None
    hash: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow, index=True)


# Payout statuses that mean money is (or may still be) out of the account
RESERVED_PAYOUT_STATUSES = {"PENDING", "SUCCESS", "UNCLAIMED", "ONHOLD", "NEW"}


def _auto_migrate() -> None:
    """Add columns that newer versions introduced to an existing SQLite file (no data loss)."""
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing:
                    continue
                coltype = col.type.compile(dialect=engine.dialect)
                default = ""
                if col.default is not None and getattr(col.default, "is_scalar", False):
                    v = col.default.arg
                    default = f" DEFAULT {int(v) if isinstance(v, bool) else repr(v) if isinstance(v, str) else v}"
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {coltype}{default}'))
                log.info("Migrated: added %s.%s", table.name, col.name)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    _auto_migrate()


def get_session():
    with Session(engine) as session:
        yield session


# ---------- tamper-evident audit log ----------
def _entry_hash(prev: str, actor: str, action: str, target, detail, ip, created_at: datetime) -> str:
    payload = json.dumps([prev, actor, action, target, detail, ip, created_at.isoformat()], ensure_ascii=False)
    return hashlib.sha256(payload.encode()).hexdigest()


_audit_lock = Lock()


def audit(_session: Session | None, actor: str, action: str, target: str | None = None,
          detail: str | None = None, ip: str | None = None) -> None:
    """Each entry stores the hash of the previous one, so editing or deleting history breaks the chain.
    Written in its own transaction under a lock, so concurrent requests can't fork the chain."""
    with _audit_lock, Session(engine) as s:
        last = s.exec(select(AuditLog).where(AuditLog.hash.is_not(None)).order_by(AuditLog.id.desc()).limit(1)).first()
        prev = last.hash if last else "GENESIS"
        created = utcnow()
        s.add(AuditLog(actor=actor, action=action, target=target, detail=detail, ip=ip, prev_hash=prev,
                       hash=_entry_hash(prev, actor, action, target, detail, ip, created), created_at=created))
        s.commit()


def verify_audit_chain(session: Session) -> dict:
    rows = session.exec(select(AuditLog).order_by(AuditLog.id)).all()
    prev = "GENESIS"
    checked = 0
    for r in rows:
        if not r.hash:  # entries from before the chain existed
            continue
        expected = _entry_hash(prev, r.actor, r.action, r.target, r.detail, r.ip, r.created_at)
        if r.prev_hash != prev or r.hash != expected:
            return {"ok": False, "checked": checked, "brokenAt": r.id}
        prev = r.hash
        checked += 1
    return {"ok": True, "checked": checked, "brokenAt": None}
