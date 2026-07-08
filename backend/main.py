"""FastAPI entry point.

Run from backend/:
    uvicorn main:app --reload --reload-dir app

Env knobs for deployment:
    CORS_ORIGIN_REGEX  — defaults to any localhost:port (covers Next.js auto-port-switch
                         and IPv6). Override when deploying behind a domain.
    FRONTEND_URL       — displayed on the root endpoint as a convenience pointer.
"""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from app import db, notify  # noqa: E402
from app.routes import router  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm the Neo4j constraints up-front — fresh deployments used to hit a
    # TransientError on the very first upload while constraints were still
    # being created inside write_graph. Best-effort: Neo4j may not be up yet.
    try:
        from app import kg

        kg.init_schema()
    except Exception as exc:
        print(f"[main] neo4j schema warm-up skipped: {exc!r}")

    # Job state is in-memory; a restart mid-analysis leaves upload_events rows
    # stuck at 'pending' forever. Flip them to error so the audit trail closes.
    try:
        n = db.mark_stale_uploads_interrupted()
        if n:
            print(f"[main] marked {n} interrupted upload(s) from a previous run")
    except Exception as exc:
        print(f"[main] stale upload cleanup failed: {exc!r}")

    # Start the daily-summary scheduler only when email is actually configured,
    # so dev/test boxes don't spin a pointless task. The task is cancelled on
    # shutdown by exiting the context.
    task = None
    if notify.smtp_configured():
        task = asyncio.create_task(_daily_summary_loop())
        print("[main] daily summary scheduler started")
    else:
        print("[main] SMTP not configured — daily summary scheduler not started")
    try:
        yield
    finally:
        if task is not None:
            task.cancel()


app = FastAPI(title="Thesis Checker", lifespan=lifespan)

CORS_ORIGIN_REGEX = os.getenv(
    "CORS_ORIGIN_REGEX",
    r"^http://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$",
)
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Let the browser read the download filename — without this, cross-origin
    # fetches can't see Content-Disposition, so a LaTeX-with-figures export
    # (returned as a .zip) gets saved with the fallback .tex extension and
    # opens as binary garbage in Overleaf.
    expose_headers=["Content-Disposition"],
)

app.include_router(router)

# ---------- daily upload summary email ----------
# uvicorn runs a single worker, so one asyncio task here is the whole schedule
# (no cron, no extra dependency). Skipped entirely when SMTP isn't configured.

SUMMARY_TZ = ZoneInfo("Asia/Taipei")


def _seconds_until_next_run(hour: int) -> float:
    now = datetime.now(SUMMARY_TZ)
    target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


async def _daily_summary_loop() -> None:
    hour = int(os.getenv("DAILY_SUMMARY_HOUR", "9"))
    while True:
        await asyncio.sleep(_seconds_until_next_run(hour))
        try:
            since = (
                (datetime.now(SUMMARY_TZ) - timedelta(days=1))
                .astimezone(ZoneInfo("UTC"))
                .isoformat()
            )
            stats = db.upload_stats_since(since)
            notify.send_daily_summary(stats, window_label="24 小時")
        except Exception as exc:  # never let the loop die
            print(f"[main] daily summary failed: {exc!r}")


@app.get("/")
def index() -> dict[str, str]:
    return {"status": "ok", "frontend": FRONTEND_URL}
