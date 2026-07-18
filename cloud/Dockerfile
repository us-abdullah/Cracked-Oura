# Cloud API image for Usman Biotracker (phone companion with laptop closed).
# Build from repo root: docker build -f cloud/Dockerfile -t biotracker-cloud .

FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    BIOTRACKER_CLOUD=1 \
    BIOTRACKER_DATA_DIR=/data \
    PORT=8000

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt \
    && playwright install-deps chromium || true
# Browsers optional on cloud (mirror hosting); Oura automation stays on desktop.

COPY backend/__init__.py /app/backend/__init__.py
COPY backend/src /app/backend/src

# Optional: Hevy Insights static UI (Training embed)
# Already under backend/src/hevy_insights_ui when present

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/cloud/status" || exit 1

CMD ["sh", "-c", "uvicorn backend.src.api.main:app --host 0.0.0.0 --port ${PORT}"]
