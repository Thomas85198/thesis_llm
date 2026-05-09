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

CREATE TABLE IF NOT EXISTS defect_judgments (
    paper_id    TEXT NOT NULL,
    defect_id   TEXT NOT NULL,
    rule_id     TEXT NOT NULL,
    verdict     TEXT NOT NULL CHECK (verdict IN ('correct', 'wrong', 'partial')),
    note        TEXT,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (paper_id, defect_id)
);
CREATE INDEX IF NOT EXISTS idx_judgments_rule ON defect_judgments(rule_id);
CREATE INDEX IF NOT EXISTS idx_judgments_paper ON defect_judgments(paper_id);
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


# ---------- defect judgments (human-as-judge evaluation) ----------

VERDICTS = ("correct", "wrong", "partial")


def upsert_judgment(
    paper_id: str,
    defect_id: str,
    rule_id: str,
    verdict: str,
    note: str | None = None,
) -> None:
    if verdict not in VERDICTS:
        raise ValueError(f"verdict must be one of {VERDICTS}, got {verdict!r}")
    with connect() as c:
        c.execute(
            """
            INSERT INTO defect_judgments
                (paper_id, defect_id, rule_id, verdict, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(paper_id, defect_id) DO UPDATE SET
                rule_id=excluded.rule_id,
                verdict=excluded.verdict,
                note=excluded.note,
                created_at=excluded.created_at
            """,
            (paper_id, defect_id, rule_id, verdict, note, _now()),
        )


def delete_judgment(paper_id: str, defect_id: str) -> None:
    with connect() as c:
        c.execute(
            "DELETE FROM defect_judgments WHERE paper_id=? AND defect_id=?",
            (paper_id, defect_id),
        )


def list_judgments(paper_id: str) -> list[dict[str, Any]]:
    with connect() as c:
        rows = c.execute(
            """
            SELECT defect_id, rule_id, verdict, note, created_at
            FROM defect_judgments
            WHERE paper_id = ?
            """,
            (paper_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def judgment_summary() -> dict[str, Any]:
    """Per-rule + global counts of correct/wrong/partial judgments + precision."""
    with connect() as c:
        rows = c.execute(
            """
            SELECT rule_id,
                   COUNT(*) AS total,
                   SUM(CASE WHEN verdict='correct' THEN 1 ELSE 0 END) AS correct,
                   SUM(CASE WHEN verdict='wrong'   THEN 1 ELSE 0 END) AS wrong,
                   SUM(CASE WHEN verdict='partial' THEN 1 ELSE 0 END) AS partial
            FROM defect_judgments
            GROUP BY rule_id
            ORDER BY rule_id
            """
        ).fetchall()
        global_row = c.execute(
            """
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN verdict='correct' THEN 1 ELSE 0 END) AS correct,
                   SUM(CASE WHEN verdict='wrong'   THEN 1 ELSE 0 END) AS wrong,
                   SUM(CASE WHEN verdict='partial' THEN 1 ELSE 0 END) AS partial
            FROM defect_judgments
            """
        ).fetchone()

    by_rule = []
    for r in rows:
        d = dict(r)
        # Precision = correct / total (partial counted as 0.5 for soft precision)
        total = d["total"] or 0
        d["precision"] = (
            (d["correct"] + 0.5 * d["partial"]) / total if total else None
        )
        by_rule.append(d)

    g = dict(global_row) if global_row else {"total": 0, "correct": 0, "wrong": 0, "partial": 0}
    g_total = g["total"] or 0
    g["precision"] = (
        (g["correct"] + 0.5 * g["partial"]) / g_total if g_total else None
    )
    return {"by_rule": by_rule, "total": g}


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
