FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

# Run as a non-root user; the SQLite database + uploads live in /data (a Docker volume)
RUN useradd --create-home --uid 10001 reliefpay && mkdir -p /data && chown -R reliefpay /data /app
USER reliefpay
ENV DATA_DIR=/data APP_ENV=production TRUST_PROXY=true

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
