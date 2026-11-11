# ReliefPay 🆘💸

**Fast, fair, transparent disaster aid, powered by PayPal + AI.**

> After a disaster, cash aid takes **weeks**, part of it is lost to **duplicate and fake claims**,
> and donors **never see where their money went**. ReliefPay fixes all three.

| Problem | ReliefPay |
|---|---|
| 🐢 Aid takes weeks | Families apply from a phone in any language (type **or speak**). AI reads and ranks every request in seconds. PayPal Payouts sends money to many families in one batch. |
| 🎭 Fraud and duplicates | Perceptual photo matching, duplicate phone / PayPal account detection, copy-paste story detection, plus AI consistency checks |
| 🤷 No donor trust | A public transparency page shows every dollar in and out, live, with no personal data |

Built for the **PayPal AI Hackathon 2026**.

---

## ✨ Features

**New in v3:** 🌊 *Did the disaster really happen?* check (GDACS + NASA EONET + campaign zones + AI news search) ·
🔍 photo evidence viewer (AI marks objects with boxes and checks the photo against the story) · 💸 *Pay this family*
button with a pre-payment checklist · 🚩 *Mark as fraud* + blocklist · 🎯 need categories (food, shelter, medical,
education, livelihood) · ₹ INR donations with an impact line · 🧑‍⚖️ *Try it as a judge* one-click login + guided tour ·
🚀 one-service Render deployment · wider, more professional layout.

**New in v2:** 💚 *Follow my dollar* receipts · 🏆 donor wall (families helped per donor) · 💱 8 currencies ·
🌍 public site in English, हिन्दी, தமிழ், Filipino, Español · 🔊 status replies in the applicant's own language ·
🤖 tool-using Payout Agent that asks clarifying questions · 🔁 monthly giving (PayPal Subscriptions) ·
📱 Venmo payouts · 🔔 PayPal webhooks · 🧠 AI situation report · 🗺️ map · 🔗 tamper-proof audit chain

**Public site** (switch language at the top right)
- **Donate** with PayPal Checkout (Orders API v2) in **USD, EUR, GBP, AUD, CAD, SGD, JPY or PHP**, or give **monthly** with PayPal Subscriptions. The server verifies the captured amount and currency with PayPal and uses PayPal's real exchange rate when it converts.
- **Receipt code + Follow my dollar**: every donation gets a code (e.g. `DN-7K2Q9X`); entering it shows exactly which families (by town) the money reached, oldest-donation-first, with an AI-written thank-you note.
- **Donor wall**: top donors who opted in, grouped by PayPal payer, with the number of families their money reached.
- **Apply for help**: 3-step form, **voice input** (7 languages), photo upload (metadata/GPS stripped), privacy notice.
- **Track request** with reference code + last 4 phone digits. The status is also shown **in the applicant's own language** (Hindi, Tamil, Filipino, Spanish built-in; other languages translated by AI) with a 🔊 **Listen** button.
- Families choose to be paid by **PayPal email** or **Venmo** (US phone number).
- **Transparency dashboard**: money in vs. out, families helped, avg. hours to aid, suspicious requests caught, payouts by town.

**Staff app** (login required)
- **Dashboard** with funds card stack, 7-day flow chart, urgent queue, activity feed.
- **Applications**: AI urgency score + reasons, damage level, vulnerabilities, photo check, English translation, fraud signals; approve / reject / re-run AI.
- **AI situation report** (one click) and a **requests map** coloured by urgency.
- **Payout Agent** 🤖 now *uses tools* (check funds, list towns, look up approved families) with Gemini/Claude function calling, shows every step it took, and **asks a clarifying question** when the instruction is unclear (e.g. a town with no approved families). Type *"Pay approved families in Guiuan with urgency above 70, max $200 each"*. The AI turns it into filters, code builds a rule-checked plan, and an **admin confirms** before **PayPal Payouts** sends the batch. Batch status syncs back from PayPal.
- **Donations** ledger (currency, receipt, monthly) and a **tamper-proof audit log**: each entry stores the SHA-256 hash of the previous one; the Audit page verifies the whole chain.

## 🧠 How PayPal and AI are used

| PayPal | Where |
|---|---|
| JS SDK buttons + **Orders API v2** (create / capture) | Donations (`backend/app/paypal.py`, `routers/public.py`) |
| **Payouts API v1** (create batch / get batch) | Sending aid + status sync (`routers/staff.py`) |
| **Payouts to Venmo** (`recipient_wallet: VENMO`) | US families paid by phone number |
| **Catalog Products + Billing Plans + Subscriptions** | Monthly giving |
| **Webhooks** + `verify-webhook-signature` | Payout items, batches, captures and subscription payments update automatically |
| `PayPal-Request-Id` idempotency keys | No double charges or double payouts on retries |

| AI (Gemini, Claude, or offline rules) | Where |
|---|---|
| Multilingual triage: language, English summary, damage, vulnerabilities, **urgency 0-100 with reasons** | `backend/app/ai.py` → `triage()` |
| Photo vs. story consistency check (vision) | same call, image attached |
| **Tool-using Payout Agent** (function calling, clarifying questions) | `run_payout_agent()` |
| Status-message translation, donor thank-you notes, daily situation report | `translate()`, `thank_you_note()`, `situation_report()` |
| Approximate coordinates of each town for the map | part of `triage()` |

**Safety by design:** applicant text is treated as *data* (prompt-injection resistant); every AI output is validated and clamped in code; aid amounts use a **transparent formula in code**, not AI; **the AI never moves money**.

## 🔐 Security

- Passwords hashed with **bcrypt**; sessions are **JWT in an httpOnly, SameSite=Strict cookie** (no tokens in JavaScript; CSRF-resistant)
- **Roles**: `reviewer` approves/rejects; only `admin` can send money
- **Rate limits** on login, applications, donations, status lookups, agent and payouts
- Same error for wrong email/password (no account probing); timing-safe login
- **Server-side checks** before money moves: plan is single-use and expires in 10 min, eligibility re-checked, per-family and per-batch caps, available funds
- High-fraud-risk approvals require a written justification; high-risk cases are never auto-included in payouts
- Uploads: size limit, real image verification (Pillow), re-encoded to JPEG (**strips EXIF/GPS**), random filenames, served only to logged-in staff, path-traversal guard
- Security headers + **Content-Security-Policy**; API docs hidden in production; non-root Docker user
- Public endpoints never expose names, emails or phones
- Full **audit log** of logins, decisions, plans and payouts

---

## 🚀 Quick start

### 1. Get your keys (10 minutes)
1. **PayPal sandbox**: log in at https://developer.paypal.com → **Apps & Credentials** → make sure **Sandbox** is selected → **Create App** → copy **Client ID** and **Secret**.
   Under **Testing Tools → Sandbox Accounts** you'll find a *Personal* (buyer) account. Use it to donate. Its email is also a good payout receiver.
2. **Gemini (free)**: https://aistudio.google.com → **Get API key**.
   *(Skip this and set `AI_PROVIDER=heuristic` to run without AI.)*

### 2. Configure
```bash
cd backend
cp .env.example .env      # Windows: copy .env.example .env
```
Open `backend/.env` and fill in `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `GEMINI_API_KEY`.
Staff logins are already in there (change them before deploying anywhere public):

| Role | Email | Password |
|---|---|---|
| Admin (can send payouts) | `admin@reliefpay.org` | `Admin#2026demo` |
| Reviewer | `reviewer@reliefpay.org` | `Review#2026demo` |

### 3a. Run with Docker (recommended)
```bash
# from the project root (folder with docker-compose.yml)
docker compose up --build
```
Open **http://localhost:8080** · staff area: **http://localhost:8080/staff**

Stop: `Ctrl+C` · Reset all data: `docker compose down -v`

### 3b. Run without Docker
Needs **Python 3.11+** and **Node.js 18+**.
```bash
# Terminal 1 - backend
cd backend
python -m venv .venv
.venv\Scripts\activate          # Mac/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2 - frontend
cd frontend
npm install
npm run dev
```
Open **http://localhost:5173** · API docs: http://localhost:8000/api/docs

---

## 🌊 Disaster check (never rejects anyone)
When an applicant says a flood, storm or earthquake hit them, ReliefPay checks, in order:
1. **Campaign zones** you define in `DISASTER_ZONES` (inside one = confirmed)
2. **GDACS** (UN/EU Global Disaster Alert and Coordination System) - floods, cyclones, earthquakes near the town in the last 30 days
3. **NASA EONET** - floods and severe storms (storm tracks included)
4. **AI web search** (Gemini with Google Search, or Claude web search) - only if the free sources found nothing; shows news links

Results: ✅ *confirmed*, ⚠️ *not confirmed - check before paying* (a medium-risk warning), or *could not check* (no flag).
Requests that don't claim a disaster (e.g. school fees) are simply *non-disaster requests* and are not flagged.
Results are cached per town per day, so 100 applications from one town make one set of calls.

## 💸 Paying, fraud marking and photo evidence (staff)
- **Pay this family** (admin): one PayPal payout to one family, after a checklist (approved, fraud risk, disaster, photo, funds,
  PayPal). High-risk or fraud-marked requests can't be paid; if the disaster wasn't confirmed, a written reason is required
  and logged. Double clicks can't pay twice.
- **Mark as fraud** (any staff, undo = admin): rejects the request and remembers its phone, payout account and photo;
  any later request that matches is flagged high-risk automatically.
- **View & analyse photo**: full-screen photo; the AI draws labelled boxes (e.g. *Flood water - knee-deep*, *Air
  conditioner - submerged*), estimates water depth, scores how well the photo supports the story, and warns about
  screenshots / stock / AI-generated images. Needs a working AI key.

## 🚀 Deploy to Render (one service)
The root `Dockerfile` builds the website and serves it from the API, so everything runs on one address.
1. Push the repo to GitHub (check `git status` does **not** list `backend/.env`).
2. render.com → **New → Blueprint** → choose the repo (it reads `render.yaml`).
3. Fill the secret values: `ADMIN_EMAIL`, `ADMIN_PASSWORD` (use a new strong one), `REVIEWER_EMAIL`, `REVIEWER_PASSWORD`,
   `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `GEMINI_API_KEY`, `SANDBOX_RECIPIENT_EMAILS` (leave `PAYPAL_WEBHOOK_ID` empty for now).
4. **Apply** and wait for `ReliefPay ready` in the logs (5-10 min).
5. Webhook (optional): PayPal app → Add Webhook → `https://YOUR-APP.onrender.com/api/public/paypal/webhook`,
   tick *Payments & Payouts* and *Billing subscription*, put the Webhook ID in `PAYPAL_WEBHOOK_ID`.

Free plan notes: the service sleeps after ~15 minutes idle (first visit takes ~1 minute) and the database resets to the
demo data on restart. `JUDGE_DEMO_LOGIN=true` is set in `render.yaml` so judges get the one-click reviewer login.

Test the single-service image locally:
```bash
docker build -t reliefpay .
docker run --rm -p 8000:8000 --env-file backend/.env -e COOKIE_SECURE=false reliefpay
# open http://localhost:8000
```

## ⬆️ Upgrading from v1
Keep your existing `backend/.env` (all new settings have safe defaults). The database **upgrades itself** on start
(new columns are added automatically, no data lost). For the new demo donors, receipts and map, start fresh:
set `SEED_DEMO_DATA=true`, then `docker compose down -v` and `docker compose up --build`.

## 🔔 PayPal webhooks (when hosted)
Webhooks need a public HTTPS URL, so they work after you deploy (not on localhost).
1. developer.paypal.com → your app → **Add Webhook** → URL `https://YOUR-SITE/api/public/paypal/webhook`
2. Tick: `Payment capture completed/denied/refunded`, `Payouts item *`, `Payouts batch *`, `Payment sale completed`, `Billing subscription *`.
3. Copy the **Webhook ID** into `PAYPAL_WEBHOOK_ID` and restart. Unsigned or replayed events are rejected.
Without webhooks everything still works; use **Refresh from PayPal** on a payout batch.

## 🗄️ SQLite: you don't need to install anything

SQLite is a database that lives in **one file**. Python already includes it.

- The app creates it automatically on first start:
  - Without Docker: `backend/data/reliefpay.db` (uploaded photos in `backend/data/uploads/`)
  - With Docker: inside the `reliefpay-data` volume (survives restarts)
- On first start it also **creates the staff accounts from `.env`** and **demo data** (12 applications incl. 3 fraud cases, 20 donations, 1 payout batch). Turn demo data off with `SEED_DEMO_DATA=false`.
- **Start fresh:** stop the app and delete `backend/data/` (or `docker compose down -v`).
- **Look inside the database (optional):**
  - Easiest: install **DB Browser for SQLite** (free, https://sqlitebrowser.org) → *Open Database* → `backend/data/reliefpay.db`.
  - Command line: `sqlite3 backend/data/reliefpay.db ".tables"` then `SELECT ref_code, full_name, urgency_score, status FROM application;`
  - Docker: `docker compose cp backend:/data/reliefpay.db ./reliefpay.db`, then open that copy.
- Tables: `staffuser`, `donation`, `application`, `payoutbatch`, `payout`, `agentplan`, `auditlog`.
- Changed a password in `.env`? Just restart. The account is updated automatically.

## 🎬 3-minute demo script
1. **Public site**: show the campaign, donate $50 with the sandbox buyer account → confetti → total updates.
2. **Get help**: apply in Tagalog/Hindi **by voice**, add a photo → reference code.
3. **Staff → Applications**: open the new request → AI urgency, English summary, photo check.
4. Open **Mark Tan** → *"Photo matches… Same phone… Story 97% identical"* → fraud caught.
5. Approve a few families → **Payout Agent**: *"Pay approved families with urgency above 70, max $250 each"* → plan → **Send with PayPal** → batch created → **Refresh from PayPal**.
6. **Transparency** page: money out, families helped, hours to aid.

> **Tip for real sandbox payouts:** put your sandbox *personal* account email(s) in `SANDBOX_RECIPIENT_EMAILS` (before first start, or delete `data/` and restart), or approve applications that use that email. Payouts to unknown emails show as **Unclaimed** in the sandbox, which is expected. Your sandbox *business* account needs a balance (sandbox accounts come with test money).

## 🧪 Tests
```bash
cd backend && pytest -q
```
44 end-to-end tests (PayPal, AI and disaster feeds mocked): auth & cookies, roles, fraud detection, triage, fake-image rejection, high-risk approval rules, single-use payout plans, capture amount verification, no PII on public endpoints, multi-currency conversion, receipts + leaderboard, status translation, Venmo, agent tool loops (Gemini + Claude), situation report + map, audit-chain tamper detection, webhook verification + replay protection, database auto-migration, INR charging in USD, disaster check (confirmed / not found / unknown, GDACS + EONET parsing, web search), need categories, mark-as-fraud blocklist, pay-one-family rules, photo analysis boxes + flags, judge login, Gemini model fallback, single-service website serving + path traversal.

## 🧩 Project structure
```
reliefpay/
├── docker-compose.yml
├── backend/                 FastAPI + SQLite
│   ├── app/
│   │   ├── main.py          app, middleware, error handling
│   │   ├── config.py        settings from .env
│   │   ├── db.py            database models
│   │   ├── security.py      bcrypt, JWT cookies, roles, rate limits, headers
│   │   ├── paypal.py        Orders v2 + Payouts v1 client
│   │   ├── ai.py            Gemini / Claude / offline triage + payout agent
│   │   ├── fraud.py         image checks + duplicate detection
│   │   ├── services.py      funds, triage runner, payout planning
│   │   ├── seed.py          staff + demo data
│   │   └── routers/         public.py, staff.py
│   └── tests/
└── frontend/                React + Vite + Tailwind + Framer Motion
    ├── nginx.conf           production server + /api proxy + CSP
    └── src/
        ├── components/      UI kit, charts, layouts, brand cards
        └── pages/           public/ and staff/
```

## 🛠️ Troubleshooting
| Problem | Fix |
|---|---|
| "PayPal isn't configured yet" | Fill `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` in `backend/.env`, restart |
| PayPal error 401 / "rejected the credentials" | You copied Live keys. Use the **Sandbox** app keys |
| Payout error about permissions / insufficient funds | Sandbox business account needs balance; check the sandbox account in the PayPal dashboard |
| AI shows "heuristic (AI unavailable)" | Gemini key missing/invalid or free-tier limit reached; it falls back to offline rules automatically. Check `GEMINI_MODEL` against AI Studio's model list |
| Voice button missing | Use Chrome or Edge (Web Speech API) |
| 🔊 Listen is silent for Tamil/Hindi | Your computer has no voice for that language. Windows: Settings → Time & language → Speech → Add voices |
| Monthly button shows an error | Make sure **Subscriptions** is ticked in your PayPal app's features |
| Non-USD donation shows "processing" | Your sandbox business account must accept that currency (PayPal sandbox → Account settings → Payment preferences) |
| "AI: offline rules" or "AI was unavailable" | The dashboard and each request now show the reason (bad key, model not found, quota). Fix `.env`, restart, click **Re-run AI**. On quota errors the app tries `GEMINI_FALLBACK_MODELS` automatically |
| Photo analysis says it needs an AI key | Boxes need a vision model: set a working `GEMINI_API_KEY` |
| INR donation charged in USD | Expected: PayPal only lets India-registered accounts receive INR. The donor still sees ₹ on receipts and the donor wall |
| Map is grey | The map tiles come from openstreetmap.org; check your internet connection |
| Can't log in | Use the email/password from `backend/.env`; more than 8 login attempts in 5 minutes from one IP are blocked briefly |
| PayPal buttons blank in Docker | Open the browser console; if you see a CSP error, add the blocked PayPal domain to `frontend/nginx.conf` |

## ⚠️ Honest limitations
- Recipients need a PayPal account (email) to receive aid, so ReliefPay targets NGOs working where PayPal Payouts is available.
- AI scores are **advice**; a human approves every payment.
- Rate limits are in-memory (single server). Use Redis for multiple servers.
- Sandbox only. Production would need KYC, PayPal Payouts approval and HTTPS (`COOKIE_SECURE=true`).

## 📄 License
MIT. See [LICENSE](LICENSE).
