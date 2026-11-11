# One container that serves the website AND the API (used for Render).
# Local development can still use docker-compose.yml (two containers).

# ---- 1. build the React app ----
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2. Python API that also serves the built site ----
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install -r requirements.txt
COPY backend/app ./app
COPY --from=web /web/dist ./static
RUN useradd --create-home --uid 10001 reliefpay && mkdir -p /data && chown -R reliefpay /data /app
USER reliefpay
ENV APP_ENV=production TRUST_PROXY=true STATIC_DIR=/app/static DATA_DIR=/data PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/api/health')"
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
