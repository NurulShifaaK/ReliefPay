"""Image handling + fraud signals (duplicates, reused photos, copy-pasted stories)."""
import io
import re
import uuid
from difflib import SequenceMatcher

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlmodel import Session, select

from .config import settings
from .db import Application, FraudBlocklist

MAX_UPLOAD_BYTES = 6 * 1024 * 1024
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}


class BadImage(ValueError):
    pass


def process_upload(data: bytes) -> tuple[str, str, bytes]:
    """Validate an uploaded image, strip metadata (EXIF/GPS) by re-encoding,
    save it under a random name. Returns (filename, dhash, jpeg_bytes)."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise BadImage("Photo is too large (max 6 MB).")
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()                      # detects truncated / fake files
        img = Image.open(io.BytesIO(data))
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise BadImage("That file is not a valid image.")
    if img.format not in ALLOWED_FORMATS:
        raise BadImage("Please upload a JPG, PNG or WEBP photo.")
    img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((1600, 1600))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)     # new file = no original metadata
    jpeg = buf.getvalue()
    name = f"{uuid.uuid4().hex}.jpg"
    (settings.upload_dir / name).write_bytes(jpeg)
    return name, dhash(img), jpeg


def dhash(img: Image.Image, size: int = 8) -> str:
    """Perceptual 'difference hash': near-identical photos give near-identical hashes,
    even after resizing or re-compressing."""
    small = img.convert("L").resize((size + 1, size), Image.LANCZOS)
    px = list(small.getdata())
    bits = 0
    for row in range(size):
        for col in range(size):
            left = px[row * (size + 1) + col]
            right = px[row * (size + 1) + col + 1]
            bits = (bits << 1) | (left > right)
    return f"{bits:016x}"


def hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def _norm(text: str) -> str:
    return re.sub(r"\W+", " ", text.lower()).strip()


def _digits(phone: str) -> str:
    return re.sub(r"\D", "", phone)[-10:]


def find_fraud_signals(session: Session, app: Application) -> list[str]:
    """Compare one application against all others. Returns human-readable flags."""
    flags: list[str] = []
    others = session.exec(select(Application).where(Application.id != app.id)).all()
    my_phone, my_email, my_text = _digits(app.phone), (app.paypal_email or "").lower(), _norm(app.raw_text)

    for o in others:
        if my_phone and _digits(o.phone) == my_phone:
            flags.append(f"Same phone number as application {o.ref_code}")
        if my_email and (o.paypal_email or "").lower() == my_email:
            flags.append(f"Same PayPal account as application {o.ref_code}")
        if app.venmo_phone and o.venmo_phone and _digits(o.venmo_phone) == _digits(app.venmo_phone):
            flags.append(f"Same Venmo account as application {o.ref_code}")
        if app.photo_hash and o.photo_hash and hamming(app.photo_hash, o.photo_hash) <= 6:
            flags.append(f"Photo matches the photo in application {o.ref_code}")
        if len(my_text) > 40:
            ratio = SequenceMatcher(None, my_text, _norm(o.raw_text)).ratio()
            if ratio >= 0.85:
                flags.append(f"Story is {int(ratio * 100)}% identical to application {o.ref_code}")

    # People previously marked as fraud by staff (same phone, payout account or photo)
    for b in session.exec(select(FraudBlocklist).where(FraudBlocklist.application_ref != app.ref_code)).all():
        if ((my_phone and b.phone_digits == my_phone) or (my_email and b.paypal_email == my_email)
                or (app.venmo_phone and b.venmo_phone and _digits(b.venmo_phone) == _digits(app.venmo_phone))
                or (app.photo_hash and b.photo_hash and hamming(app.photo_hash, b.photo_hash) <= 6)):
            flags.append(f"Matches an applicant previously marked as fraud ({b.application_ref})")

    # Disaster verification (never a rejection: staff check before paying)
    if app.claims_disaster and app.disaster_status == "not_found":
        event = app.claimed_event or "disaster"
        flags.append(f"Says there was a {event} in {app.location}, but no recent {event} was found there")
    if app.marked_fraud:
        flags.append(f"Marked as fraud by staff: {app.fraud_reason or 'no reason given'}")
    return sorted(set(flags))


def risk_level(flags: list[str]) -> str:
    strong = ("Same phone", "Same PayPal", "Same Venmo", "Photo matches", "Matches an applicant previously marked",
              "Marked as fraud")
    if any(f.startswith(strong) for f in flags):
        return "high"
    return "medium" if flags else "low"
