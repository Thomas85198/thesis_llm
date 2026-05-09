"""FastAPI entry point.

Run from backend/:
    uvicorn main:app --reload --reload-dir app
"""
from __future__ import annotations

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from app.routes import router  # noqa: E402

app = FastAPI(title="Thesis Checker (v3)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/")
def index() -> dict[str, str]:
    return {"status": "ok", "frontend": "http://localhost:3000"}
