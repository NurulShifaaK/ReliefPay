"""Passwords, JWT cookie sessions, roles, rate limiting, security headers."""
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from threading import Lock

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, Response, status
from sqlmodel import Session, select
from starlette.middleware.base import BaseHTTPMiddleware

from .config import settings
from .db import StaffUser, get_session

COOKIE_NAME = "rp_session"
ALGO = "HS256"


# ---------- passwords ----------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


# A real hash used when the email doesn't exist, so login timing doesn't leak which emails exist.
_DUMMY_HASH = hash_password("timing-equaliser")


# ---------- sessions (JWT in an httpOnly cookie) ----------
def set_session_cookie(response: Response, user: StaffUser) -> None:
    exp = datetime.now(timezone.utc) + timedelta(hours=settings.JWT_HOURS)
    token = jwt.encode({"sub": str(user.id), "role": user.role, "exp": exp}, settings.JWT_SECRET, ALGO)
    response.set_cookie(
        COOKIE_NAME, token,
        httponly=True,                 # JavaScript can't read it (XSS-safe)
        secure=settings.COOKIE_SECURE,  # HTTPS only in production
        samesite="strict",             # blocks cross-site requests (CSRF)
        max_age=int(settings.JWT_HOURS * 3600),
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


def current_user(request: Request, session: Session = Depends(get_session)) -> StaffUser:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGO])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    user = session.get(StaffUser, int(payload["sub"]))
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown user")
    return user


def require_role(*roles: str):
    def checker(user: StaffUser = Depends(current_user)) -> StaffUser:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have permission for this action")
        return user
    return checker


def authenticate(session: Session, email: str, password: str) -> StaffUser | None:
    user = session.exec(select(StaffUser).where(StaffUser.email == email.lower().strip())).first()
    if not user:
        verify_password(password, _DUMMY_HASH)
        return None
    return user if verify_password(password, user.password_hash) else None


# ---------- rate limiting (in-memory sliding window, per IP + bucket) ----------
class RateLimiter:
    def __init__(self):
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = Lock()

    def check(self, key: str, limit: int, window_s: int) -> None:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window_s:
                q.popleft()
            if len(q) >= limit:
                retry = int(window_s - (now - q[0])) + 1
                raise HTTPException(429, f"Too many requests. Try again in {retry}s.",
                                    headers={"Retry-After": str(retry)})
            q.append(now)

    def reset(self):
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    # Only trust proxy headers behind our own proxy (nginx in Docker, or Render); otherwise anyone could fake them.
    if settings.TRUST_PROXY:
        for h in ("true-client-ip", "cf-connecting-ip"):   # Render (Cloudflare) sets these; clients can't fake them
            if request.headers.get(h):
                return request.headers[h].strip()
        if request.headers.get("x-real-ip"):
            return request.headers["x-real-ip"].strip()
        fwd = request.headers.get("x-forwarded-for")
        if fwd:  # the right-most entry is the one added by the proxy itself
            return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(bucket: str, limit: int, window_s: int):
    def dep(request: Request):
        limiter.check(f"{bucket}:{client_ip(request)}", limit, window_s)
    return dep


# ---------- security headers ----------
class SecurityHeaders(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if request.url.path.startswith("/api/"):
            response.headers["Permissions-Policy"] = "camera=(), geolocation=()"
            response.headers["Cache-Control"] = "no-store"
            response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; img-src 'self'"
        else:  # the website itself (single-service hosting, e.g. Render)
            response.headers["Permissions-Policy"] = "camera=(self), microphone=(self), geolocation=()"
            response.headers["Content-Security-Policy"] = WEB_CSP
            if settings.COOKIE_SECURE:
                response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


WEB_CSP = ("default-src 'self'; "
           "script-src 'self' https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com; "
           "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; "
           "img-src 'self' data: blob: https://*.paypal.com https://*.paypalobjects.com https://*.tile.openstreetmap.org; "
           "connect-src 'self' https://*.paypal.com https://*.paypalobjects.com; "
           "frame-src https://*.paypal.com https://*.venmo.com; frame-ancestors 'none'; base-uri 'self'; "
           "form-action 'self' https://*.paypal.com")
