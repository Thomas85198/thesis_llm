"""FastAPI entry point.

Run from backend/:
    uvicorn main:app --reload --reload-dir app

Env knobs for deployment:
    CORS_ORIGIN_REGEX  — defaults to any localhost:port (covers Next.js auto-port-switch
                         and IPv6). Override when deploying behind a domain.
    FRONTEND_URL       — displayed on the root endpoint as a convenience pointer.
"""
from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from app.routes import router  # noqa: E402

app = FastAPI(title="Thesis Checker (v3)")

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
)

app.include_router(router)


@app.get("/")
def index() -> dict[str, str]:
    return {"status": "ok", "frontend": FRONTEND_URL}
