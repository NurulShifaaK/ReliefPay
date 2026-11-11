"""PayPal REST client (sandbox): Orders v2, Payouts v1 (PayPal + Venmo), Subscriptions, Webhooks."""
import time
import uuid

import httpx

from .config import settings

_token: dict = {"value": None, "expires": 0.0}


class PayPalError(Exception):
    pass


def configured() -> bool:
    return bool(settings.PAYPAL_CLIENT_ID and settings.PAYPAL_CLIENT_SECRET)


def fmt_amount(amount: float, currency: str) -> str:
    decimals = settings.CURRENCIES.get(currency, {}).get("decimals", 2)
    return f"{amount:.{decimals}f}"


async def _access_token() -> str:
    if not configured():
        raise PayPalError("PayPal is not configured. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env")
    if _token["value"] and time.time() < _token["expires"] - 60:
        return _token["value"]
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"{settings.PAYPAL_BASE_URL}/v1/oauth2/token",
                auth=(settings.PAYPAL_CLIENT_ID, settings.PAYPAL_CLIENT_SECRET),
                data={"grant_type": "client_credentials"},
            )
    except httpx.HTTPError as e:
        raise PayPalError(f"Cannot reach PayPal ({e.__class__.__name__}). Check your internet connection.")
    if r.status_code != 200:
        raise PayPalError("PayPal rejected the credentials. Check PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET.")
    data = r.json()
    _token["value"], _token["expires"] = data["access_token"], time.time() + data["expires_in"]
    return _token["value"]


async def _request(method: str, path: str, json: dict | None = None, request_id: str | None = None) -> dict:
    token = await _access_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if request_id:  # idempotency: retrying the same call never charges/pays twice
        headers["PayPal-Request-Id"] = request_id
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.request(method, f"{settings.PAYPAL_BASE_URL}{path}", json=json, headers=headers)
    except httpx.HTTPError as e:
        raise PayPalError(f"Cannot reach PayPal ({e.__class__.__name__}).")
    if r.status_code >= 400:
        try:
            body = r.json()
            msg = body.get("message") or body.get("name") or r.text
            details = body.get("details") or []
            if details:
                msg += " - " + "; ".join(d.get("issue", "") for d in details[:3])
        except ValueError:
            msg = r.text
        raise PayPalError(f"PayPal error ({r.status_code}): {msg}")
    return r.json() if r.content else {}


# ---------- Orders v2 (one-time donations, any supported currency) ----------
async def create_order(amount: float, currency: str, description: str) -> dict:
    return await _request("POST", "/v2/checkout/orders", {
        "intent": "CAPTURE",
        "purchase_units": [{
            "description": description[:127],
            "amount": {"currency_code": currency, "value": fmt_amount(amount, currency)},
        }],
        "payment_source": {"paypal": {"experience_context": {
            "shipping_preference": "NO_SHIPPING",
            "user_action": "PAY_NOW",
            "brand_name": "ReliefPay",
        }}},
    }, request_id=str(uuid.uuid4()))


async def capture_order(order_id: str) -> dict:
    return await _request("POST", f"/v2/checkout/orders/{order_id}/capture", {}, request_id=f"cap-{order_id}")


# ---------- Payouts v1 ----------
def payout_item(receiver: str, method: str, amount_usd: float, sender_item_id: str, note: str) -> dict:
    item = {
        "amount": {"currency": "USD", "value": f"{amount_usd:.2f}"},
        "sender_item_id": sender_item_id,
        "note": note[:4000],
    }
    if method == "VENMO":  # Venmo payouts: US phone number, USD only
        item.update({"recipient_type": "PHONE", "receiver": receiver, "recipient_wallet": "VENMO"})
    else:
        item.update({"recipient_type": "EMAIL", "receiver": receiver})
    return item


async def create_payout_batch(sender_batch_id: str, items: list[dict]) -> dict:
    """items: [{receiver, method, amount_usd, sender_item_id, note}]"""
    return await _request("POST", "/v1/payments/payouts", {
        "sender_batch_header": {
            "sender_batch_id": sender_batch_id,
            "email_subject": "You have received emergency relief funds",
            "email_message": "ReliefPay has sent you emergency assistance. Stay safe.",
        },
        "items": [payout_item(it["receiver"], it.get("method", "PAYPAL"), it["amount_usd"],
                              it["sender_item_id"], it.get("note", "Emergency relief from ReliefPay"))
                  for it in items],
    }, request_id=sender_batch_id)


async def get_payout_batch(paypal_batch_id: str) -> dict:
    return await _request("GET", f"/v1/payments/payouts/{paypal_batch_id}?page_size=1000")


# ---------- Subscriptions (monthly donations) ----------
async def create_product(name: str) -> dict:
    return await _request("POST", "/v1/catalogs/products", {
        "name": name[:127], "type": "SERVICE",
        "description": "Monthly donation to the ReliefPay emergency fund",
    }, request_id=f"prod-{uuid.uuid4()}")


async def create_monthly_plan(product_id: str, amount_usd: int) -> dict:
    return await _request("POST", "/v1/billing/plans", {
        "product_id": product_id,
        "name": f"ReliefPay monthly ${amount_usd}",
        "status": "ACTIVE",
        "billing_cycles": [{
            "frequency": {"interval_unit": "MONTH", "interval_count": 1},
            "tenure_type": "REGULAR", "sequence": 1, "total_cycles": 0,
            "pricing_scheme": {"fixed_price": {"value": f"{amount_usd:.2f}", "currency_code": "USD"}},
        }],
        "payment_preferences": {"auto_bill_outstanding": True, "payment_failure_threshold": 3},
    }, request_id=f"plan-{product_id}-{amount_usd}")


async def get_subscription(subscription_id: str) -> dict:
    return await _request("GET", f"/v1/billing/subscriptions/{subscription_id}")


# ---------- Webhooks ----------
async def verify_webhook(headers: dict, event: dict) -> bool:
    """Ask PayPal whether this webhook really came from PayPal (signature check)."""
    if not settings.PAYPAL_WEBHOOK_ID:
        return False
    h = {k.lower(): v for k, v in headers.items()}
    body = {
        "auth_algo": h.get("paypal-auth-algo"),
        "cert_url": h.get("paypal-cert-url"),
        "transmission_id": h.get("paypal-transmission-id"),
        "transmission_sig": h.get("paypal-transmission-sig"),
        "transmission_time": h.get("paypal-transmission-time"),
        "webhook_id": settings.PAYPAL_WEBHOOK_ID,
        "webhook_event": event,
    }
    if not all(body.values()):
        return False
    result = await _request("POST", "/v1/notifications/verify-webhook-signature", body)
    return result.get("verification_status") == "SUCCESS"
