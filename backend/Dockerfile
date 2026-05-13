# syntax=docker/dockerfile:1
# Multi-stage build: builder installs deps, runtime is a slim copy.

# ---------- Builder ----------
FROM python:3.11-slim AS builder

# Build-time tools only — kept out of the runtime image.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy minimal install metadata first to maximise layer cache hits.
COPY pyproject.toml ./
# Create a placeholder app/ so pip install -e . succeeds at this stage.
RUN mkdir -p app && touch app/__init__.py main.py

RUN pip install --no-cache-dir --upgrade pip setuptools && \
    pip install --no-cache-dir -e .

# Now copy real source. The editable install picks it up at runtime via .pth.
COPY app/ ./app/
COPY prompts/ ./prompts/
COPY rules.yaml ./
COPY main.py ./
COPY scripts/ ./scripts/

# ---------- Runtime ----------
FROM python:3.11-slim AS runtime

# PyMuPDF wheels are self-contained on Linux x86_64/arm64; no extra apt deps needed.
# We install tini for proper PID 1 signal handling under docker compose.
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy installed packages + source from builder.
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /build /app

# DATA_DIR is where SQLite + uploads/ live (mount a volume here).
ENV DATA_DIR=/data \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Pre-create /data so the mount has a valid mountpoint even without a volume.
RUN mkdir -p /data/uploads

EXPOSE 8000

ENTRYPOINT ["/usr/bin/tini", "--"]
# NOTE: no --reload in prod; uvicorn workers can be tuned via uvicorn.workers env.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
