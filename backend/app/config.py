"""All settings come from environment variables (see .env.example)."""
import json
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


class Settings:
    # App
    ENV = os.getenv("APP_ENV", "development")
    DATA_DIR = Path(os.getenv("DATA_DIR", "./data")).resolve()
    DATABASE_URL = os.getenv("DATABASE_URL", "")  # default: sqlite file inside DATA_DIR
    FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
    # Folder with the built React app. When set, the API also serves the website (one service, e.g. Render).
    STATIC_DIR = os.getenv("STATIC_DIR", "")

    # Security
    _jwt = os.getenv("JWT_SECRET", "")
    # A missing/placeholder/short secret is replaced by a random one (sessions reset on restart).
    JWT_SECRET = _jwt if len(_jwt) >= 32 and not _jwt.startswith("change-me") else secrets.token_urlsafe(48)
    JWT_HOURS = _float("JWT_HOURS", 8)
    COOKIE_SECURE = _bool("COOKIE_SECURE", False)  # set true behind HTTPS
    TRUST_PROXY = _bool("TRUST_PROXY", False)      # true only behind our nginx (Docker)

    # Staff accounts seeded on startup
    ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@reliefpay.org")
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
    ADMIN_NAME = os.getenv("ADMIN_NAME", "Maria Santos")
    REVIEWER_EMAIL = os.getenv("REVIEWER_EMAIL", "reviewer@reliefpay.org")
    REVIEWER_PASSWORD = os.getenv("REVIEWER_PASSWORD", "")
    REVIEWER_NAME = os.getenv("REVIEWER_NAME", "Arjun Mehta")

    # PayPal (sandbox)
    PAYPAL_CLIENT_ID = os.getenv("PAYPAL_CLIENT_ID", "")
    PAYPAL_CLIENT_SECRET = os.getenv("PAYPAL_CLIENT_SECRET", "")
    PAYPAL_BASE_URL = os.getenv("PAYPAL_BASE_URL", "https://api-m.sandbox.paypal.com")
    # Webhook ID from developer.paypal.com > your app > Webhooks (needed to verify webhook signatures)
    PAYPAL_WEBHOOK_ID = os.getenv("PAYPAL_WEBHOOK_ID", "")
    ENABLE_VENMO = _bool("ENABLE_VENMO", True)
    MONTHLY_TIERS_USD = [int(x) for x in os.getenv("MONTHLY_TIERS_USD", "10,25,50").split(",") if x.strip().isdigit()]

    # Currencies donors can give in. Rates are APPROXIMATE (1 unit = X USD), used for totals;
    # when PayPal converts, its real exchange rate from the capture is used instead.
    CURRENCIES = {
        "USD": {"symbol": "$", "decimals": 2, "rate": 1.0, "chips": [10, 25, 50, 100, 250]},
        "EUR": {"symbol": "€", "decimals": 2, "rate": 1.08, "chips": [10, 25, 50, 100, 250]},
        "GBP": {"symbol": "£", "decimals": 2, "rate": 1.27, "chips": [10, 20, 50, 100, 200]},
        "AUD": {"symbol": "A$", "decimals": 2, "rate": 0.66, "chips": [15, 40, 75, 150, 400]},
        "CAD": {"symbol": "C$", "decimals": 2, "rate": 0.73, "chips": [15, 35, 70, 140, 350]},
        "SGD": {"symbol": "S$", "decimals": 2, "rate": 0.74, "chips": [15, 35, 70, 140, 350]},
        "JPY": {"symbol": "¥", "decimals": 0, "rate": 0.0067, "chips": [1500, 4000, 8000, 15000, 40000]},
        "PHP": {"symbol": "₱", "decimals": 2, "rate": 0.017, "chips": [500, 1500, 3000, 6000, 15000]},
        # PayPal only lets India-registered accounts receive INR, so the donor chooses rupees and
        # PayPal charges the equivalent in USD ("charge": "USD"). Rate: INR_PER_USD in .env.
        "INR": {"symbol": "₹", "decimals": 0, "rate": round(1 / max(_float("INR_PER_USD", 96.0), 1), 6),
                "chips": [500, 1000, 2500, 5000, 10000], "charge": "USD"},
    }

    # AI
    AI_PROVIDER = os.getenv("AI_PROVIDER", "gemini").lower()  # gemini | claude | heuristic
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
    # Tried in order when the main model is rate-limited (429) or unavailable (404/5xx)
    GEMINI_FALLBACK_MODELS = [m.strip() for m in os.getenv(
        "GEMINI_FALLBACK_MODELS", "gemini-3.5-flash,gemini-3.5-flash-lite").split(",") if m.strip()]
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
    CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-haiku-5-5")

    # Campaign + safety limits
    CAMPAIGN_NAME = os.getenv("CAMPAIGN_NAME", "Typhoon Relief - Eastern Samar")
    CAMPAIGN_GOAL_USD = _float("CAMPAIGN_GOAL_USD", 10000)
    MAX_DONATION_USD = _float("MAX_DONATION_USD", 10000)
    MAX_PAYOUT_PER_FAMILY_USD = _float("MAX_PAYOUT_PER_FAMILY_USD", 500)
    MAX_BATCH_TOTAL_USD = _float("MAX_BATCH_TOTAL_USD", 5000)

    # Disaster verification ("did the flood they describe really happen?")
    try:
        DISASTER_ZONES = json.loads(os.getenv("DISASTER_ZONES", "") or "null") or [
            {"name": "Eastern Samar typhoon", "event": "typhoon", "lat": 11.25, "lng": 125.45, "radius_km": 120}]
    except ValueError:
        DISASTER_ZONES = []
    DISASTER_CHECK = _bool("DISASTER_CHECK", True)             # turn the whole check off with false
    DISASTER_LOOKBACK_DAYS = int(_float("DISASTER_LOOKBACK_DAYS", 30))
    DISASTER_RADIUS_KM = _float("DISASTER_RADIUS_KM", 150)
    DISASTER_WEB_SEARCH = _bool("DISASTER_WEB_SEARCH", True)   # let the AI search the news
    GEOCODER_USER_AGENT = os.getenv("GEOCODER_USER_AGENT", "ReliefPay/1.0 (hackathon demo)")

    # "Try it as a judge": one-click sign-in as the reviewer (can't send money). For public demos only.
    JUDGE_DEMO_LOGIN = _bool("JUDGE_DEMO_LOGIN", False)

    # Demo data
    SEED_DEMO_DATA = _bool("SEED_DEMO_DATA", True)
    SANDBOX_RECIPIENT_EMAILS = [
        e.strip() for e in os.getenv("SANDBOX_RECIPIENT_EMAILS", "").split(",") if e.strip()
    ]

    @property
    def db_url(self) -> str:
        return self.DATABASE_URL or f"sqlite:///{self.DATA_DIR / 'reliefpay.db'}"

    @property
    def upload_dir(self) -> Path:
        return self.DATA_DIR / "uploads"

    @property
    def ai_mode(self) -> str:
        """Which AI is really active (falls back to heuristic without a key)."""
        if self.AI_PROVIDER == "gemini" and self.GEMINI_API_KEY:
            return "gemini"
        if self.AI_PROVIDER == "claude" and self.ANTHROPIC_API_KEY:
            return "claude"
        return "heuristic"


settings = Settings()
settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
settings.upload_dir.mkdir(parents=True, exist_ok=True)
