"""End-to-end API tests with PayPal mocked.  Run:  cd backend && pytest -q"""
import io
import os
import tempfile

os.environ["DATA_DIR"] = tempfile.mkdtemp()
os.environ["ADMIN_PASSWORD"] = "Admin#Test123"
os.environ["REVIEWER_PASSWORD"] = "Review#Test123"
os.environ["AI_PROVIDER"] = "heuristic"
os.environ["DISASTER_CHECK"] = "false"   # no real network in tests; specific tests turn it on with mocks
os.environ["JUDGE_DEMO_LOGIN"] = "true"
_static = tempfile.mkdtemp()
os.makedirs(os.path.join(_static, "assets"))
open(os.path.join(_static, "index.html"), "w").write("<!doctype html><title>ReliefPay</title><div id=root></div>")
open(os.path.join(_static, "favicon.svg"), "w").write("<svg xmlns='http://www.w3.org/2000/svg'/>")
os.environ["STATIC_DIR"] = _static
os.environ["PAYPAL_CLIENT_ID"] = "test-id"
os.environ["PAYPAL_CLIENT_SECRET"] = "test-secret"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app import paypal  # noqa: E402
from app.main import app  # noqa: E402
from app.security import limiter  # noqa: E402


@pytest.fixture()
def client():
    limiter.reset()
    with TestClient(app) as c:
        yield c


def login(c, role="admin"):
    email = "admin@reliefpay.org" if role == "admin" else "reviewer@reliefpay.org"
    pw = os.environ["ADMIN_PASSWORD"] if role == "admin" else os.environ["REVIEWER_PASSWORD"]
    r = c.post("/api/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r


def test_health_and_seed(client):
    assert client.get("/api/health").json()["ok"]
    stats = client.get("/api/public/stats").json()
    assert stats["raisedUsd"] > 0 and stats["donors"] == 20


def test_security_headers(client):
    r = client.get("/api/health")
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["x-content-type-options"] == "nosniff"


def test_staff_routes_need_login(client):
    client.cookies.clear()
    assert client.get("/api/staff/dashboard").status_code == 401
    assert client.post("/api/staff/auth/login", json={"email": "admin@reliefpay.org", "password": "nope"}).status_code == 401


def test_login_cookie_is_httponly(client):
    r = login(client)
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie


def test_seeded_fraud_detected(client):
    login(client)
    apps = client.get("/api/staff/applications").json()
    risky = {a["fullName"]: a["fraud"] for a in apps}
    assert risky["Mark Tan"]["risk"] == "high"
    assert any("Photo matches" in f for f in risky["Marco Tanedo"]["flags"])
    assert risky["Danica Robles"]["risk"] == "medium"


def _photo():
    buf = io.BytesIO()
    Image.new("RGB", (300, 200), (40, 90, 140)).save(buf, "PNG")
    return buf.getvalue()


def test_apply_triage_and_status(client):
    r = client.post("/api/public/applications", data={
        "full_name": "Test Person", "phone": "+63 900 111 2233", "paypal_email": "test.person@example.com",
        "location": "Guiuan", "household_size": "4", "consent": "true",
        "message": "Our house was destroyed by the flood. We have 2 children and no food.",
    }, files={"photo": ("p.png", _photo(), "image/png")})
    assert r.status_code == 200, r.text
    ref = r.json()["ref"]
    s = client.get("/api/public/applications/status", params={"ref": ref, "phone_last4": "2233"})
    assert s.status_code == 200 and s.json()["status"] == "PENDING"
    assert client.get("/api/public/applications/status", params={"ref": ref, "phone_last4": "0000"}).status_code == 404
    login(client, "reviewer")
    a = next(x for x in client.get("/api/staff/applications").json() if x["ref"] == ref)
    assert a["ai"]["status"] == "DONE" and a["ai"]["damage"] == "severe"
    assert a["ai"]["urgency"] >= 70 and "children" in a["ai"]["vulnerabilities"]


def test_rejects_fake_image(client):
    r = client.post("/api/public/applications", data={
        "full_name": "Bad File", "phone": "+63 900 999 1111", "paypal_email": "bad@example.com",
        "location": "Guiuan", "household_size": "2", "consent": "true",
        "message": "This is a long enough message for validation to pass.",
    }, files={"photo": ("x.jpg", b"<script>alert(1)</script>", "image/jpeg")})
    assert r.status_code == 422


def test_reviewer_cannot_send_money(client):
    login(client, "reviewer")
    plan = client.post("/api/staff/agent/plan", json={"instruction": "Pay everyone approved"}).json()
    assert plan["canExecute"] is False
    assert client.post("/api/staff/agent/execute", json={"token": plan["token"]}).status_code == 403


def test_high_risk_approval_needs_note(client):
    login(client)
    apps = client.get("/api/staff/applications").json()
    mark = next(a for a in apps if a["fullName"] == "Mark Tan")
    r = client.post(f"/api/staff/applications/{mark['id']}/decision", json={"decision": "APPROVE"})
    assert r.status_code == 422


def test_agent_plan_and_payout(client, monkeypatch):
    async def fake_batch(sender_batch_id, items):
        return {"batch_header": {"payout_batch_id": "PB123", "batch_status": "PENDING"}}
    monkeypatch.setattr(paypal, "create_payout_batch", fake_batch)
    login(client)
    plan = client.post("/api/staff/agent/plan",
                       json={"instruction": "Pay approved families with urgency above 60, max $200 each, total under $1000"}).json()
    assert plan["filters"]["min_urgency"] == 60
    assert all(i["amount_usd"] <= 200 and i["urgency"] >= 60 for i in plan["items"])
    assert plan["total_usd"] <= 1000 and plan["items"]
    r = client.post("/api/staff/agent/execute", json={"token": plan["token"]})
    assert r.status_code == 200, r.text
    assert client.post("/api/staff/agent/execute", json={"token": plan["token"]}).status_code == 404  # single use
    assert any(b["paypalBatchId"] == "PB123" for b in client.get("/api/staff/payouts").json())


def test_donation_capture_verifies_amount(client, monkeypatch):
    async def fake_create(amount, currency, desc):
        return {"id": "ORDER1234567890"}
    async def fake_capture(order_id):  # PayPal says only $1 was captured
        return {"status": "COMPLETED", "payer": {"name": {"given_name": "Eve"}}, "purchase_units": [
            {"payments": {"captures": [{"id": "C1", "status": "COMPLETED",
                                        "amount": {"value": "1.00", "currency_code": "USD"}}]}}]}
    monkeypatch.setattr(paypal, "create_order", fake_create)
    monkeypatch.setattr(paypal, "capture_order", fake_capture)
    assert client.post("/api/public/donations/create-order", json={"amount": 50, "currency": "USD"}).status_code == 200
    assert client.post("/api/public/donations/ORDER1234567890/capture").status_code == 402


def test_transparency_hides_personal_data(client):
    t = client.get("/api/public/transparency").json()
    text = str(t)
    assert "@" not in text and "+63" not in text
    assert t["familiesHelped"] >= 3


# ---------------- v2 features ----------------
def test_currencies_and_monthly_in_config(client):
    cfg = client.get("/api/public/config").json()
    codes = {c["code"] for c in cfg["currencies"]}
    assert {"USD", "EUR", "JPY", "PHP"} <= codes and cfg["monthlyTiers"]


def test_multicurrency_capture_converts_to_usd(client, monkeypatch):
    async def fake_create(amount, currency, desc):
        assert currency == "EUR" and amount == 40
        return {"id": "ORDEREUR1234567"}
    async def fake_capture(order_id):
        return {"status": "COMPLETED", "payer": {"payer_id": "PAYERX1", "name": {"given_name": "Lena"}},
                "purchase_units": [{"payments": {"captures": [{
                    "id": "CAPEUR1", "status": "COMPLETED", "amount": {"value": "40.00", "currency_code": "EUR"},
                    "seller_receivable_breakdown": {"exchange_rate": {
                        "source_currency": "EUR", "target_currency": "USD", "value": "1.10"}}}]}}]}
    monkeypatch.setattr(paypal, "create_order", fake_create)
    monkeypatch.setattr(paypal, "capture_order", fake_capture)
    r = client.post("/api/public/donations/create-order",
                    json={"amount": 40, "currency": "EUR", "display_name": "Lena B.", "show_on_leaderboard": True})
    assert r.status_code == 200, r.text
    cap = client.post("/api/public/donations/ORDEREUR1234567/capture").json()
    assert cap["status"] == "COMPLETED" and cap["amount"] == 44.0 and cap["receipt"].startswith("DN-")
    rec = client.get(f"/api/public/donations/receipt/{cap['receipt']}").json()
    assert rec["display"] == "€40.00" and rec["note"]
    assert any(row["name"] == "Lena B." for row in client.get("/api/public/leaderboard?limit=50").json())


def test_unsupported_currency_rejected(client):
    assert client.post("/api/public/donations/create-order", json={"amount": 10, "currency": "XYZ"}).status_code == 422


def test_follow_my_dollar_seed_receipt(client):
    rec = client.get("/api/public/donations/receipt/DN-DEMO01").json()
    assert rec["families"] >= 1 and rec["slices"] and "@" not in str(rec)
    assert client.get("/api/public/donations/receipt/DN-NOPE99").status_code == 404


def test_leaderboard_groups_repeat_donors(client):
    board = client.get("/api/public/leaderboard").json()
    priya = next(r for r in board if r["name"] == "Priya Raman")
    assert priya["donations"] == 3 and priya["monthly"] is True
    assert "Kenji Sato" not in {r["name"] for r in board}  # opted out


def test_status_reply_in_applicant_language(client):
    r = client.post("/api/public/applications", data={
        "full_name": "Meena", "phone": "+91 98400 12345", "paypal_email": "meena@example.com",
        "location": "Thanjavur", "household_size": "3", "consent": "true",
        "message": "எங்கள் வீடு வெள்ளத்தில் மூழ்கியது. இரண்டு குழந்தைகள் உள்ளனர். The house is flooded and we have no food.",
    })
    ref = r.json()["ref"]
    # Offline AI guesses English for mixed text; set language as Gemini would.
    from app.db import Application, engine
    from sqlmodel import Session, select
    with Session(engine) as s:
        a = s.exec(select(Application).where(Application.ref_code == ref)).first()
        a.language = "Tamil"
        s.add(a); s.commit()
    st = client.get("/api/public/applications/status", params={"ref": ref, "phone_last4": "2345"}).json()
    assert st["local"]["code"] == "ta" and st["local"]["speech"] == "ta-IN" and st["local"]["text"]


def test_venmo_application(client):
    r = client.post("/api/public/applications", data={
        "full_name": "Jo Smith", "phone": "+1 713 555 0100", "payout_method": "VENMO", "venmo_phone": "(713) 555-0100",
        "location": "Houston", "household_size": "2", "consent": "true",
        "message": "Our apartment flooded and we lost everything in the storm.",
    })
    assert r.status_code == 200, r.text
    bad = client.post("/api/public/applications", data={
        "full_name": "Jo Smith", "phone": "+1 713 555 0101", "payout_method": "VENMO", "venmo_phone": "123",
        "location": "Houston", "household_size": "2", "consent": "true", "message": "x" * 20})
    assert bad.status_code == 422


def test_venmo_payout_item_format():
    item = paypal.payout_item("7135550100", "VENMO", 120, "S1", "note")
    assert item["recipient_wallet"] == "VENMO" and item["recipient_type"] == "PHONE"
    assert paypal.payout_item("a@b.com", "PAYPAL", 1, "S2", "n")["recipient_type"] == "EMAIL"


def test_agent_offline_shows_steps_and_clarifies(client):
    login(client)
    rosa = next(a for a in client.get("/api/staff/applications").json() if a["fullName"] == "Rosalinda Dela Cruz")
    assert client.post(f"/api/staff/applications/{rosa['id']}/decision", json={"decision": "APPROVE"}).status_code == 200
    plan = client.post("/api/staff/agent/plan", json={"instruction": "Pay approved families with urgency above 70"}).json()
    assert plan["kind"] == "plan" and [s["tool"] for s in plan["steps"]][:2] == ["get_funds", "list_approved_families"]
    q = client.post("/api/staff/agent/plan", json={"instruction": "Pay approved families with urgency above 99"}).json()
    assert q["kind"] == "clarify" and "Towns" in q["question"]


def test_situation_report_and_map(client):
    login(client, "reviewer")
    rep = client.post("/api/staff/report").json()
    assert rep["headline"] and len(rep["bullets"]) >= 3
    pts = client.get("/api/staff/map").json()
    assert pts and all(p["lat"] is not None for p in pts)
    pub = client.get("/api/public/transparency").json()
    assert pub["map"] and "name" not in pub["map"][0] and pub["leaderboard"]


def test_audit_chain_detects_tampering(client):
    login(client)
    assert client.get("/api/staff/audit/verify").json()["ok"] is True
    from app.db import AuditLog, engine
    from sqlmodel import Session, select
    with Session(engine) as s:
        row = s.exec(select(AuditLog).where(AuditLog.hash.is_not(None)).order_by(AuditLog.id)).first()
        original = row.detail
        row.detail = "tampered"
        s.add(row); s.commit()
        res = client.get("/api/staff/audit/verify").json()
        assert res["ok"] is False and res["brokenAt"] == row.id
        row.detail = original
        s.add(row); s.commit()


def test_webhook_requires_verification(client, monkeypatch):
    from app.config import settings
    r = client.post("/api/public/paypal/webhook", json={"id": "WH-1", "event_type": "PAYMENT.CAPTURE.COMPLETED"})
    assert r.status_code == 503  # no webhook id configured
    monkeypatch.setattr(settings, "PAYPAL_WEBHOOK_ID", "WHID")
    async def fake_verify(headers, event):
        return False
    monkeypatch.setattr(paypal, "verify_webhook", fake_verify)
    assert client.post("/api/public/paypal/webhook", json={"id": "WH-2", "event_type": "X"}).status_code == 401


def test_webhook_updates_payout_status(client, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "PAYPAL_WEBHOOK_ID", "WHID")
    async def ok(headers, event):
        return True
    monkeypatch.setattr(paypal, "verify_webhook", ok)
    from app.db import Payout, engine
    from sqlmodel import Session, select
    with Session(engine) as s:
        p = s.exec(select(Payout)).first()
        item = p.sender_item_id
    ev = {"id": "WH-PAY-1", "event_type": "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
          "resource": {"transaction_status": "UNCLAIMED", "payout_item": {"sender_item_id": item}}}
    assert client.post("/api/public/paypal/webhook", json=ev).json()["ok"]
    assert client.post("/api/public/paypal/webhook", json=ev).json().get("duplicate")  # replay ignored
    with Session(engine) as s:
        assert s.exec(select(Payout).where(Payout.sender_item_id == item)).first().status == "UNCLAIMED"


def test_auto_migration_adds_missing_columns(tmp_path):
    import sqlite3
    from sqlalchemy import create_engine, inspect
    from app import db as dbmod
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE donation (id INTEGER PRIMARY KEY, paypal_order_id VARCHAR, amount_usd FLOAT, "
                "status VARCHAR, is_seed BOOLEAN, created_at DATETIME, paypal_capture_id VARCHAR, donor_name VARCHAR)")
    con.commit(); con.close()
    old = dbmod.engine
    dbmod.engine = create_engine(f"sqlite:///{path}")
    try:
        dbmod.init_db()
        cols = {c["name"] for c in inspect(dbmod.engine).get_columns("donation")}
        assert {"currency", "receipt_code", "show_on_leaderboard"} <= cols
    finally:
        dbmod.engine = old


class _FakeResp:
    def __init__(self, data):
        self.status_code, self._data = 200, data
    def json(self):
        return self._data
    @property
    def text(self):
        return str(self._data)


def _fake_client(script, seen):
    class C:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, json=None, headers=None):
            seen.append(json)
            return _FakeResp(script.pop(0))
    return C


def test_gemini_agent_tool_loop(monkeypatch):
    import asyncio, httpx
    from app import ai
    from app.config import settings
    monkeypatch.setattr(settings, "AI_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "k")
    script = [
        {"candidates": [{"content": {"role": "model", "parts": [
            {"functionCall": {"name": "get_funds", "args": {}}, "thoughtSignature": "sig1"}]}}]},
        {"candidates": [{"content": {"role": "model", "parts": [
            {"functionCall": {"name": "list_approved_families", "args": {"town": "Guiuan"}}}]}}]},
        {"candidates": [{"content": {"role": "model", "parts": [
            {"functionCall": {"name": "ask_clarification", "args": {"question": "No approved families in Guiuan. Pay Borongan?"}}}]}}]},
    ]
    seen = []
    monkeypatch.setattr(httpx, "AsyncClient", _fake_client(script, seen))
    tools = {"get_funds": lambda a: {"available_usd": 900}, "list_towns": lambda a: {"towns": []},
             "list_approved_families": lambda a: {"count": 0, "families": []},
             "_summarise": lambda n, a, r: n}
    out = asyncio.run(ai.run_payout_agent("Pay Guiuan", [], tools, ["Guiuan", "Borongan"]))
    assert out["kind"] == "clarify" and "Borongan" in out["question"]
    assert [s["tool"] for s in out["steps"]] == ["get_funds", "list_approved_families"]
    # model turn echoed back with its thought signature, then our functionResponse
    second = seen[1]["contents"]
    assert second[1]["parts"][0]["thoughtSignature"] == "sig1"
    assert second[2]["parts"][0]["functionResponse"]["name"] == "get_funds"


def test_claude_agent_tool_loop(monkeypatch):
    import asyncio, httpx
    from app import ai
    from app.config import settings
    monkeypatch.setattr(settings, "AI_PROVIDER", "claude")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "k")
    script = [
        {"content": [{"type": "tool_use", "id": "t1", "name": "get_funds", "input": {}}]},
        {"content": [{"type": "text", "text": "ok"}, {"type": "tool_use", "id": "t2", "name": "propose_plan",
                      "input": {"min_urgency": 70, "towns": ["Borongan"], "max_per_family_usd": 200,
                                "explanation": "Pay Borongan families above 70"}}]},
    ]
    seen = []
    monkeypatch.setattr(httpx, "AsyncClient", _fake_client(script, seen))
    tools = {"get_funds": lambda a: {"available_usd": 900}, "_summarise": lambda n, a, r: n}
    out = asyncio.run(ai.run_payout_agent("Pay Borongan above 70, $200 each", [], tools, ["Borongan"]))
    assert out["kind"] == "plan" and out["filters"]["locations"] == ["Borongan"]
    assert out["filters"]["min_urgency"] == 70 and out["filters"]["max_per_family_usd"] == 200
    assert seen[1]["messages"][2]["content"][0]["tool_use_id"] == "t1"



# ---------------- v3 features ----------------
def _apply(client, **over):
    data = {"full_name": "Asha Devi", "phone": "+91 90000 11122", "paypal_email": "asha@example.com",
            "location": "Jaipur", "household_size": "3", "consent": "true",
            "message": "Our house was flooded last night and we lost our food and clothes."}
    data.update(over)
    r = client.post("/api/public/applications", data=data)
    assert r.status_code == 200, r.text
    return r.json()["ref"]


def _staff_app(client, ref):
    return next(a for a in client.get("/api/staff/applications").json() if a["ref"] == ref)


def test_inr_is_shown_in_rupees_but_charged_in_usd(client, monkeypatch):
    seen = {}
    async def fake_create(amount, currency, desc):
        seen.update(amount=amount, currency=currency)
        return {"id": "ORDERINR12345678"}
    async def fake_capture(order_id):
        return {"status": "COMPLETED", "payer": {"payer_id": "PINR1", "name": {"given_name": "Ravi"}},
                "purchase_units": [{"payments": {"captures": [{
                    "id": "CAPINR1", "status": "COMPLETED",
                    "amount": {"value": f"{seen['amount']:.2f}", "currency_code": "USD"}}]}}]}
    monkeypatch.setattr(paypal, "create_order", fake_create)
    monkeypatch.setattr(paypal, "capture_order", fake_capture)
    cfg = client.get("/api/public/config").json()
    inr = next(c for c in cfg["currencies"] if c["code"] == "INR")
    assert inr["charge"] == "USD" and inr["symbol"] == "₹"
    r = client.post("/api/public/donations/create-order", json={"amount": 5000, "currency": "INR"})
    assert r.status_code == 200, r.text
    assert seen["currency"] == "USD" and 40 < seen["amount"] < 70
    cap = client.post("/api/public/donations/ORDERINR12345678/capture").json()
    assert cap["status"] == "COMPLETED" and cap["display"] == "₹5,000"
    assert client.get("/api/public/stats").json()["avgAidUsd"] > 0


def test_zone_and_distance_math():
    from app import disaster
    assert 30 < disaster.haversine_km(11.25, 125.45, 11.033, 125.724) < 50
    assert disaster.zone_check(11.033, 125.724)["inside"] is True          # Guiuan
    far = disaster.zone_check(26.912, 75.787)                              # Jaipur
    assert far["inside"] is False and far["distance_km"] > 3000


def _disaster_on(monkeypatch, gdacs, eonet, web=None, geo=(26.912, 75.787)):
    from app import ai, disaster
    from app.config import settings
    disaster.clear_cache()
    monkeypatch.setattr(settings, "DISASTER_CHECK", True)
    async def g(days): return gdacs
    async def e(days): return eonet
    async def w(location, event, days): return web
    async def geocode(place): return geo
    monkeypatch.setattr(disaster, "_gdacs_events", g)
    monkeypatch.setattr(disaster, "_eonet_events", e)
    monkeypatch.setattr(disaster, "geocode", geocode)
    monkeypatch.setattr(ai, "web_disaster_check", w)


def test_disaster_confirmed_by_official_event(client, monkeypatch):
    ev = [{"source": "GDACS", "type": "flood", "lat": 26.95, "lng": 75.80, "name": "Flood in India",
           "date": "2026-11-08", "alert": "Orange", "url": "https://www.gdacs.org/report.aspx?eventid=1"}]
    _disaster_on(monkeypatch, ev, [])
    ref = _apply(client, phone="+91 90000 22201", paypal_email="d1@example.com",
                 message="Flood water entered our home near the river yesterday and ruined the kitchen.")
    login(client, "reviewer")
    a = _staff_app(client, ref)
    assert a["disaster"]["status"] == "confirmed" and a["disaster"]["check"]["events"][0]["source"] == "GDACS"
    assert not any("no recent" in f for f in a["fraud"]["flags"])


def test_disaster_not_found_is_a_warning_not_a_rejection(client, monkeypatch):
    _disaster_on(monkeypatch, [], [], web={"confirmed": False, "confidence": 0.8, "summary": "No reports.",
                                            "eventType": "none", "date": None, "sources": []})
    ref = _apply(client, phone="+91 90000 22202", paypal_email="d2@example.com")
    login(client, "reviewer")
    a = _staff_app(client, ref)
    assert a["status"] == "PENDING" and a["disaster"]["status"] == "not_found"
    assert any("no recent flood was found" in f for f in a["fraud"]["flags"]) and a["fraud"]["risk"] == "medium"


def test_disaster_unknown_when_sources_fail_raises_no_flag(client, monkeypatch):
    _disaster_on(monkeypatch, None, None, web=None)
    ref = _apply(client, phone="+91 90000 22203", paypal_email="d3@example.com",
                 message="Heavy rain caused a flood in our street; the ground floor is under water, we need shelter.")
    login(client, "reviewer")
    a = _staff_app(client, ref)
    assert a["disaster"]["status"] == "unknown" and a["fraud"]["risk"] == "low"


def test_web_search_can_confirm(client, monkeypatch):
    _disaster_on(monkeypatch, [], [], web={"confirmed": True, "confidence": 0.9, "summary": "Flooding reported.",
                 "eventType": "flood", "date": "2026-11-09", "sources": [{"title": "news", "url": "https://example.org/a"}]})
    ref = _apply(client, phone="+91 90000 22204", paypal_email="d4@example.com",
                 message="The canal overflowed and our rooms flooded. My parents are old and have no dry place to sleep.")
    login(client, "reviewer")
    assert _staff_app(client, ref)["disaster"]["status"] == "confirmed"


def test_education_request_without_disaster_claim_is_not_flagged(client, monkeypatch):
    _disaster_on(monkeypatch, [], [])
    ref = _apply(client, phone="+91 90000 22205", paypal_email="d5@example.com", need_category="education",
                 message="I need help to pay my school fees and books for this semester please.")
    login(client, "reviewer")
    a = _staff_app(client, ref)
    assert a["need"] == "education" and a["disaster"]["status"] == "not_claimed" and a["fraud"]["flags"] == []
    assert client.post("/api/public/applications", data={
        "full_name": "X Y", "phone": "+91 90000 22206", "paypal_email": "d6@example.com", "location": "Jaipur",
        "household_size": "1", "consent": "true", "need_category": "yacht",
        "message": "long enough message for validation"}).status_code == 422


def test_seed_has_disaster_and_photo_examples(client):
    login(client, "reviewer")
    apps = {a["fullName"]: a for a in client.get("/api/staff/applications").json()}
    assert apps["Vikram Sethi"]["disaster"]["status"] == "not_found"
    assert any("no recent flood" in f for f in apps["Vikram Sethi"]["fraud"]["flags"])
    assert apps["Grace Ilagan"]["disaster"]["status"] == "not_claimed" and apps["Grace Ilagan"]["need"] == "education"
    assert apps["Imelda Bacsal"]["disaster"]["status"] == "confirmed" and apps["Imelda Bacsal"]["fraud"]["risk"] == "low"
    photo = apps["Imelda Bacsal"]["photoAnalysis"]
    assert len(photo["objects"]) >= 3 and all(len(o["box"]) == 4 for o in photo["objects"])


def test_mark_fraud_blocklists_and_flags_the_next_application(client):
    ref1 = _apply(client, phone="+91 90000 33301", paypal_email="liar@example.com",
                  message="We were hit by a big flood and my shop is gone, send money to me quickly please.")
    login(client, "reviewer")
    a1 = _staff_app(client, ref1)
    assert client.post(f"/api/staff/applications/{a1['id']}/mark-fraud", json={"reason": "short"}).status_code == 422
    r = client.post(f"/api/staff/applications/{a1['id']}/mark-fraud", json={"reason": "Lied about a flood in Jaipur"})
    assert r.status_code == 200 and r.json()["status"] == "REJECTED" and r.json()["fraud"]["risk"] == "high"
    assert client.post(f"/api/staff/applications/{a1['id']}/decision", json={"decision": "APPROVE"}).status_code == 409
    client.cookies.clear()
    ref2 = _apply(client, full_name="New Name", phone="+91 90000 33301", paypal_email="other@example.com",
                  message="A flood destroyed my small farm tools and seeds, so I can not work at the moment.")
    login(client, "reviewer")
    a2 = _staff_app(client, ref2)
    assert a2["fraud"]["risk"] == "high" and any("previously marked as fraud" in f for f in a2["fraud"]["flags"])
    assert client.post(f"/api/staff/applications/{a1['id']}/unmark-fraud").status_code == 403   # reviewer
    login(client)
    assert client.post(f"/api/staff/applications/{a1['id']}/unmark-fraud").json()["status"] == "PENDING"
    assert not any("previously marked" in f for f in _staff_app(client, ref2)["fraud"]["flags"])


def test_pay_one_family_rules(client, monkeypatch):
    calls = []
    async def fake_batch(sender_batch_id, items):
        calls.append((sender_batch_id, items))
        return {"batch_header": {"payout_batch_id": "PB-ONE-1", "batch_status": "PENDING"}}
    monkeypatch.setattr(paypal, "create_payout_batch", fake_batch)
    ref = _apply(client, full_name="Pay Target", phone="+63 900 777 8899", paypal_email="paytarget@example.com",
                 location="Guiuan", message="Typhoon winds broke our roof and rain soaked the bedroom, two children are with us.")
    login(client, "reviewer")
    apps = {a["fullName"]: a for a in client.get("/api/staff/applications").json()}
    teresita, mark, vikram = apps["Pay Target"], apps["Mark Tan"], apps["Vikram Sethi"]
    assert teresita["fraud"]["risk"] == "low"
    assert client.post(f"/api/staff/applications/{teresita['id']}/decision",
                       json={"decision": "APPROVE", "amount_usd": 120}).status_code == 200
    assert client.post(f"/api/staff/applications/{teresita['id']}/pay", json={"amount_usd": 100}).status_code == 403
    chk = client.get(f"/api/staff/applications/{teresita['id']}/pay-check").json()
    assert chk["isAdmin"] is False and chk["canPay"] is False and not chk["blockers"]

    login(client)
    # high risk can never be paid
    assert client.post(f"/api/staff/applications/{mark['id']}/pay", json={"amount_usd": 50}).status_code == 409
    # over the per-family cap
    assert client.post(f"/api/staff/applications/{teresita['id']}/pay", json={"amount_usd": 99999}).status_code == 422
    # disaster not confirmed -> needs a written reason
    assert client.post(f"/api/staff/applications/{vikram['id']}/decision",
                       json={"decision": "APPROVE", "amount_usd": 60}).status_code == 200
    assert client.get(f"/api/staff/applications/{vikram['id']}/pay-check").json()["needsReason"] is True
    assert client.post(f"/api/staff/applications/{vikram['id']}/pay", json={"amount_usd": 60}).status_code == 422
    ok = client.post(f"/api/staff/applications/{vikram['id']}/pay",
                     json={"amount_usd": 60, "reason_unverified": "Field officer visited and confirmed local flooding"})
    assert ok.status_code == 200, ok.text
    # normal payment
    r = client.post(f"/api/staff/applications/{teresita['id']}/pay", json={"amount_usd": 120, "purpose": "food"})
    assert r.status_code == 200, r.text
    assert r.json()["application"]["status"] == "PAID" and r.json()["amountUsd"] == 120
    assert calls[-1][1][0]["amount_usd"] == 120 and len(calls[-1][1]) == 1
    # paying twice is refused
    assert client.post(f"/api/staff/applications/{teresita['id']}/pay", json={"amount_usd": 120}).status_code == 409
    assert len(calls) == 2
    pub = client.get("/api/public/transparency").json()
    assert any(p["purpose"] == "food" and p["amount"] == 120 for p in pub["recentPayouts"])
    assert "@" not in str(pub) and "Pay Target" not in str(pub)


def test_agent_skips_unconfirmed_disaster(client):
    login(client)
    apps = {a["fullName"]: a for a in client.get("/api/staff/applications").json()}
    danica = apps["Danica Robles"]   # medium risk, inside the zone
    assert danica["disaster"]["status"] == "confirmed"
    plan = client.post("/api/staff/agent/plan",
                       json={"instruction": "Pay everyone approved, include flagged cases"}).json()
    if plan["kind"] == "plan":
        assert all(i["disaster"] != "not_found" for i in plan["items"]) and all("need" in i for i in plan["items"])


def test_photo_analysis_boxes_and_flags(client, monkeypatch):
    from app import ai
    from app.config import settings
    r = client.post("/api/public/applications", data={
        "full_name": "Photo Person", "phone": "+63 900 444 5566", "paypal_email": "photo@example.com",
        "location": "Guiuan", "household_size": "2", "consent": "true",
        "message": "Flood water entered our living room and damaged everything."},
        files={"photo": ("p.png", _photo(), "image/png")})
    ref = r.json()["ref"]
    login(client, "reviewer")
    a = _staff_app(client, ref)
    # no AI key -> clear 503, nothing stored
    assert client.post(f"/api/staff/applications/{a['id']}/analyze-photo").status_code == 503
    monkeypatch.setattr(settings, "AI_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "k")
    async def fake_call(system, prompt, image=None):
        assert image and "<story" in prompt
        return {"summary": "A plain blue image.", "scene": "unclear", "water_depth": None, "story_match": 12,
                "match_reason": "No flood visible.", "authenticity": "screenshot", "concerns": ["flat colour"],
                "objects": [{"label": "Flood water", "note": "none visible", "kind": "hazard", "box_2d": [600, 0, 1000, 1200]},
                            {"label": "Tiny", "box_2d": [1, 1, 2, 2]}, {"label": "", "box_2d": [0, 0, 500, 500]}]}
    monkeypatch.setattr(ai, "_call", fake_call)
    res = client.post(f"/api/staff/applications/{a['id']}/analyze-photo")
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["storyMatch"] == 12 and out["objects"] == [
        {"label": "Flood water", "note": "none visible", "kind": "hazard", "box": [600, 0, 1000, 1000]}]
    flags = _staff_app(client, ref)["fraud"]["flags"]
    assert any("screenshot" in f for f in flags) and any("does not support the story" in f for f in flags)
    # cached: second call does not hit the AI again
    async def boom(*a, **k): raise AssertionError("should be cached")
    monkeypatch.setattr(ai, "_call", boom)
    assert client.post(f"/api/staff/applications/{a['id']}/analyze-photo").json()["storyMatch"] == 12


def test_judge_demo_login_is_reviewer_only(client):
    client.cookies.clear()
    r = client.post("/api/staff/auth/demo")
    assert r.status_code == 200 and r.json()["role"] == "reviewer"
    assert client.get("/api/staff/audit").status_code == 403
    plan = client.post("/api/staff/agent/plan", json={"instruction": "Pay everyone approved"}).json()
    if plan["kind"] == "plan":
        assert client.post("/api/staff/agent/execute", json={"token": plan["token"]}).status_code == 403
    assert client.get("/api/public/config").json()["judgeDemo"] is True


def test_gemini_falls_back_to_next_model_on_quota(monkeypatch):
    import asyncio, httpx
    from app import ai
    from app.config import settings
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "k")
    monkeypatch.setattr(settings, "GEMINI_MODEL", "model-a")
    monkeypatch.setattr(settings, "GEMINI_FALLBACK_MODELS", ["model-b"])
    urls = []

    class R:
        def __init__(self, code, data): self.status_code, self._d, self.text = code, data, str(data)
        def json(self): return self._d

    class C:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, json=None, headers=None):
            urls.append(url)
            return R(429, {"error": "quota"}) if "model-a" in url else R(200, {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]})
    monkeypatch.setattr(httpx, "AsyncClient", C)
    out = asyncio.run(ai._gemini_post({"contents": []}))
    assert out["candidates"] and "model-a" in urls[0] and "model-b" in urls[1]
    assert "quota" in ai._friendly_error("Gemini 429 (model-a): quota exceeded").lower()


def test_single_service_serves_the_website_safely(client):
    home = client.get("/")
    assert home.status_code == 200 and "ReliefPay" in home.text
    assert "content-security-policy" in home.headers and "paypal.com" in home.headers["content-security-policy"]
    assert client.get("/staff/applications").status_code == 200          # React Router deep link
    assert client.get("/favicon.svg").status_code == 200
    assert client.get("/api/does-not-exist").status_code == 404
    assert client.get("/api/does-not-exist").json()["detail"]
    for bad in ["/..%2f..%2fetc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/assets/../../etc/passwd"]:
        r = client.get(bad)
        assert "root:" not in r.text


def test_official_feeds_are_parsed(monkeypatch):
    """GDACS (GeoJSON) and NASA EONET (v3) response shapes -> nearby events."""
    import asyncio, httpx
    from app import disaster
    disaster.clear_cache()
    gdacs = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [79.2, 10.8]},
         "properties": {"eventtype": "FL", "name": "Flood in India", "fromdate": "2026-11-07T00:00:00",
                        "alertlevel": "Orange", "country": "India", "url": {"report": "https://www.gdacs.org/report.aspx?eventid=9"}}},
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-70.0, -33.0]},
         "properties": {"eventtype": "EQ", "name": "Earthquake in Chile", "fromdate": "2026-11-01T00:00:00"}}]}
    eonet = {"events": [{"id": "EONET_1", "title": "Tropical Storm Demo", "link": "https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1",
                         "categories": [{"id": "severeStorms", "title": "Severe Storms"}],
                         "geometry": [{"date": "2026-11-06T00:00:00Z", "type": "Point", "coordinates": [80.5, 11.5]}]}]}

    class R:
        def __init__(self, d): self.status_code, self._d = 200, d
        def json(self): return self._d

    class C:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, params=None):
            return R(gdacs if "gdacs" in url else eonet)
    monkeypatch.setattr(httpx, "AsyncClient", C)

    async def run():
        async def no_web(*a): return None
        monkeypatch.setattr(disaster.ai, "web_disaster_check", no_web)
        return await disaster.check_disaster("Thanjavur", "flood")
    out = asyncio.run(run())
    assert out["status"] == "confirmed"
    names = {e["name"] for e in out["events"]}
    assert "Flood in India" in names and "Tropical Storm Demo" in names and "Earthquake in Chile" not in names
    assert all(e["distance_km"] < 300 for e in out["events"])
    disaster.clear_cache()
