"""SQLite persistence: papers, results, content-hash cache, LLM call log.

Single-file DB at backend/data.db. Uses stdlib sqlite3 (no extra dep).
Concurrent FastAPI handlers access via short-lived connections.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

DB_PATH = Path(__file__).parent.parent / "data.db"

_init_lock = threading.Lock()
_initialized = False


SCHEMA = """
CREATE TABLE IF NOT EXISTS papers (
    paper_id      TEXT PRIMARY KEY,
    title         TEXT,
    content_hash  TEXT,
    pdf_path      TEXT,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_papers_hash ON papers(content_hash);

CREATE TABLE IF NOT EXISTS results (
    paper_id     TEXT PRIMARY KEY REFERENCES papers(paper_id) ON DELETE CASCADE,
    result_json  TEXT NOT NULL,
    finished_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_calls (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id            TEXT,
    stage               TEXT NOT NULL,
    model               TEXT NOT NULL,
    input_tokens        INTEGER NOT NULL,
    output_tokens       INTEGER NOT NULL,
    cache_read_tokens   INTEGER DEFAULT 0,
    cache_write_tokens  INTEGER DEFAULT 0,
    cost_usd            REAL NOT NULL,
    created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_calls_paper ON llm_calls(paper_id);
CREATE INDEX IF NOT EXISTS idx_llm_calls_stage ON llm_calls(stage);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_init() -> None:
    global _initialized
    if _initialized:
        return
    with _init_lock:
        if _initialized:
            return
        with sqlite3.connect(DB_PATH) as conn:
            conn.executescript(SCHEMA)
            conn.commit()
        _initialized = True


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    _ensure_init()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------- papers ----------

def upsert_paper(
    paper_id: str, title: str, content_hash: str, pdf_path: str
) -> None:
    with connect() as c:
        c.execute(
            """
            INSERT INTO papers (paper_id, title, content_hash, pdf_path, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(paper_id) DO UPDATE SET
                title=excluded.title,
                content_hash=excluded.content_hash,
                pdf_path=excluded.pdf_path
            """,
            (paper_id, title, content_hash, pdf_path, _now()),
        )


def get_paper(paper_id: str) -> dict[str, Any] | None:
    with connect() as c:
        row = c.execute(
            "SELECT * FROM papers WHERE paper_id=?", (paper_id,)
        ).fetchone()
    return dict(row) if row else None


def get_paper_by_hash(content_hash: str) -> dict[str, Any] | None:
    """Return the most recent paper matching this content hash, if any."""
    with connect() as c:
        row = c.execute(
            """
            SELECT p.* FROM papers p
            JOIN results r ON r.paper_id = p.paper_id
            WHERE p.content_hash = ?
            ORDER BY r.finished_at DESC
            LIMIT 1
            """,
            (content_hash,),
        ).fetchone()
    return dict(row) if row else None


def list_papers() -> list[dict[str, Any]]:
    with connect() as c:
        rows = c.execute(
            """
            SELECT p.paper_id, p.title, p.created_at,
                   r.result_json IS NOT NULL AS has_result,
                   r.finished_at
            FROM papers p
            LEFT JOIN results r ON r.paper_id = p.paper_id
            ORDER BY COALESCE(r.finished_at, p.created_at) DESC
            """
        ).fetchall()
    return [dict(r) for r in rows]


def delete_paper(paper_id: str) -> None:
    with connect() as c:
        c.execute("DELETE FROM papers WHERE paper_id=?", (paper_id,))


# ---------- results ----------

def upsert_result(paper_id: str, result: dict[str, Any]) -> None:
    with connect() as c:
        c.execute(
            """
            INSERT INTO results (paper_id, result_json, finished_at)
            VALUES (?, ?, ?)
            ON CONFLICT(paper_id) DO UPDATE SET
                result_json=excluded.result_json,
                finished_at=excluded.finished_at
            """,
            (paper_id, json.dumps(result, ensure_ascii=False), _now()),
        )


def get_result(paper_id: str) -> dict[str, Any] | None:
    with connect() as c:
        row = c.execute(
            "SELECT result_json FROM results WHERE paper_id=?", (paper_id,)
        ).fetchone()
    if not row:
        return None
    return json.loads(row["result_json"])


# ---------- LLM call log ----------

def log_llm_call(
    *,
    paper_id: str | None,
    stage: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    cost_usd: float,
) -> None:
    with connect() as c:
        c.execute(
            """
            INSERT INTO llm_calls
                (paper_id, stage, model, input_tokens, output_tokens,
                 cache_read_tokens, cache_write_tokens, cost_usd, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                paper_id,
                stage,
                model,
                input_tokens,
                output_tokens,
                cache_read_tokens,
                cache_write_tokens,
                cost_usd,
                _now(),
            ),
        )


def cost_summary(paper_id: str | None = None) -> dict[str, Any]:
    """Aggregate cost / tokens for a paper, or globally if paper_id is None."""
    base_sql = """
        SELECT
            COUNT(*) AS calls,
            COALESCE(SUM(input_tokens), 0)       AS input_tokens,
            COALESCE(SUM(output_tokens), 0)      AS output_tokens,
            COALESCE(SUM(cache_read_tokens), 0)  AS cache_read_tokens,
            COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
            COALESCE(SUM(cost_usd), 0.0)         AS cost_usd
        FROM llm_calls
    """
    by_stage_sql = """
        SELECT stage, model,
               COUNT(*) AS calls,
               COALESCE(SUM(input_tokens), 0)  AS input_tokens,
               COALESCE(SUM(output_tokens), 0) AS output_tokens,
               COALESCE(SUM(cost_usd), 0.0)    AS cost_usd
        FROM llm_calls
    """
    params: tuple[Any, ...] = ()
    where = ""
    if paper_id is not None:
        where = " WHERE paper_id = ?"
        params = (paper_id,)

    with connect() as c:
        total = dict(c.execute(base_sql + where, params).fetchone())
        by_stage = [
            dict(r)
            for r in c.execute(
                by_stage_sql + where + " GROUP BY stage, model ORDER BY stage", params
            ).fetchall()
        ]
    return {"total": total, "by_stage": by_stage}
