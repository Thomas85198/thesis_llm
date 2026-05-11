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
-- ============================================================
-- 表 1: papers — 論文中繼資料 + 上傳去重快取
-- ----------------------------------------------------------------
-- 每筆代表使用者上傳過的一篇論文。content_hash 是 SHA-256，
-- 用來偵測「同一份檔案是否上傳過」，命中即直接回傳之前的 paper_id
-- 不重跑 LLM。pdf_path 記錄原檔在 backend/uploads/ 的位置。
-- ============================================================
CREATE TABLE IF NOT EXISTS papers (
    paper_id      TEXT PRIMARY KEY,    -- 論文唯一識別 (格式 'paper:xxxxxxxx')
    title         TEXT,                -- 論文標題 (使用者填或檔名)
    content_hash  TEXT,                -- 檔案 SHA-256，用於上傳去重
    pdf_path      TEXT,                -- PDF 在本地磁碟的絕對路徑
    created_at    TEXT NOT NULL        -- 建立時間 (ISO 8601 UTC)
);
CREATE INDEX IF NOT EXISTS idx_papers_hash ON papers(content_hash);

-- ============================================================
-- 表 2: results — 完整分析結果 (KG + Defects + RuleMeta)
-- ----------------------------------------------------------------
-- 每筆對應一篇分析完成的論文。result_json 存整份 AnalysisResult
-- (paper_id + graph + defects + rule_meta) 的 JSON 字串。
-- 重啟後仍能秒讀回，前端 result 頁就是吃這個。
-- 透過 ON DELETE CASCADE 與 papers 表綁定 (刪 paper 會連帶刪 result)。
-- ============================================================
CREATE TABLE IF NOT EXISTS results (
    paper_id     TEXT PRIMARY KEY REFERENCES papers(paper_id) ON DELETE CASCADE,
    result_json  TEXT NOT NULL,        -- AnalysisResult 整份 JSON (graph + defects)
    finished_at  TEXT NOT NULL         -- 分析完成時間 (ISO 8601 UTC)
);

-- ============================================================
-- 表 3: llm_calls — 每次 LLM 呼叫的 token / cost log
-- ----------------------------------------------------------------
-- Pipeline 每呼叫一次 Anthropic API 就 INSERT 一筆。給三件事用:
--   1. /api/cost 結算每篇 / 全域成本
--   2. 監控 context window 使用率 (見 docs/REPORT_QA.md §Q6)
--   3. 找出哪個 stage 最貴 / 哪篇論文最貴的 outlier
-- 注意 paper_id 允許 NULL (例如未來可能有非論文相關的 system call)。
-- ============================================================
CREATE TABLE IF NOT EXISTS llm_calls (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id            TEXT,             -- 屬於哪篇論文 (可 NULL)
    stage               TEXT NOT NULL,    -- pipeline 階段 (edu:Method / er:Intro / rule_check:REL-09 / cross_section_pass / chat ...)
    model               TEXT NOT NULL,    -- 使用的 Claude model id (e.g. claude-sonnet-4-6)
    input_tokens        INTEGER NOT NULL, -- 此次 input token 數
    output_tokens       INTEGER NOT NULL, -- 此次 output token 數
    cache_read_tokens   INTEGER DEFAULT 0,-- 從 prompt cache 讀取的 token (便宜)
    cache_write_tokens  INTEGER DEFAULT 0,-- 寫入 prompt cache 的 token (首次)
    cost_usd            REAL NOT NULL,    -- 此次美元成本 (依 PRICING dict 計算)
    created_at          TEXT NOT NULL     -- 呼叫時間 (ISO 8601 UTC)
);
CREATE INDEX IF NOT EXISTS idx_llm_calls_paper ON llm_calls(paper_id);
CREATE INDEX IF NOT EXISTS idx_llm_calls_stage ON llm_calls(stage);

-- ============================================================
-- 表 4: defect_judgments — Human-as-judge 標註 (Phase 2 燃料)
-- ----------------------------------------------------------------
-- 每筆對應「學長對某缺陷的一次判定」。複合主鍵 (paper_id, defect_id)
-- 確保同一缺陷只能有一個 verdict (改判會用 ON CONFLICT 覆寫)。
-- 兩個用途:
--   1. 評估系統 precision (correct / wrong / partial 算 soft precision)
--   2. Phase 2 — 規則檢核時自動撈該規則最近 N 個判定當 few-shot
--      examples 注入 LLM system prompt，讓 LLM 越用越貼近學長口味
-- verdict 用 CHECK 約束限定三值，避免髒資料污染 Phase 2 注入內容。
-- ============================================================
CREATE TABLE IF NOT EXISTS defect_judgments (
    paper_id    TEXT NOT NULL,       -- 缺陷所屬論文
    defect_id   TEXT NOT NULL,       -- 缺陷 id (對應 results.json 內的 defect.id)
    rule_id     TEXT NOT NULL,       -- 該缺陷觸發的規則 (REL-01 ~ REL-13)
    verdict     TEXT NOT NULL CHECK (verdict IN ('correct', 'wrong', 'partial')),
                                     -- correct=判對 / wrong=誤判 / partial=部分對
    note        TEXT,                -- 學長的補充說明 (選填，會餵給 Phase 2 LLM)
    created_at  TEXT NOT NULL,       -- 標註時間 (ISO 8601 UTC)
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


def get_judgment_examples(
    rule_id: str, limit_per_verdict: int = 4
) -> list[dict[str, Any]]:
    """Recent human judgments for ONE rule, joined with the original defect text.

    Returns up to `limit_per_verdict` correct + `limit_per_verdict` wrong examples,
    each shaped as:
        {verdict, description, suggestion, evidence_texts: [str], note}
    Used to build few-shot calibration examples in rules.check_rule().
    """
    with connect() as c:
        rows = c.execute(
            """
            SELECT j.paper_id, j.defect_id, j.verdict, j.note, j.created_at,
                   r.result_json
            FROM defect_judgments j
            JOIN results r ON r.paper_id = j.paper_id
            WHERE j.rule_id = ? AND j.verdict IN ('correct', 'wrong')
            ORDER BY j.created_at DESC
            """,
            (rule_id,),
        ).fetchall()

    bucket: dict[str, list[dict[str, Any]]] = {"correct": [], "wrong": []}
    for r in rows:
        v = r["verdict"]
        if len(bucket[v]) >= limit_per_verdict:
            continue
        try:
            result = json.loads(r["result_json"])
        except Exception:
            continue
        defect = next(
            (d for d in result.get("defects", []) if d.get("id") == r["defect_id"]),
            None,
        )
        if defect is None:
            continue
        edu_map = {
            e["id"]: e.get("text", "")
            for e in result.get("graph", {}).get("edus", [])
        }
        evidence_texts = [
            (edu_map.get(eid) or "").strip()
            for eid in defect.get("evidence_edu_ids", [])
        ]
        evidence_texts = [t for t in evidence_texts if t]
        bucket[v].append(
            {
                "verdict": v,
                "description": defect.get("description", ""),
                "suggestion": defect.get("suggestion", ""),
                "evidence_texts": evidence_texts,
                "note": r["note"],
            }
        )
        if len(bucket["correct"]) >= limit_per_verdict and len(bucket["wrong"]) >= limit_per_verdict:
            break

    return bucket["correct"] + bucket["wrong"]


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


def export_judgments_with_defects() -> dict[str, Any]:
    """Full JSON dump of all judgments enriched with the original defect details.

    For each judgment, JOIN with results.result_json to pull out the defect's
    severity / confidence / section / description / suggestion so the exported
    file is self-contained (學長 can review without back-reference to the system).

    Used by GET /api/judgments/export — student exports this as ground truth.
    """
    out: list[dict[str, Any]] = []
    with connect() as c:
        rows = c.execute(
            """
            SELECT j.paper_id, j.defect_id, j.rule_id, j.verdict, j.note,
                   j.created_at AS judged_at,
                   r.result_json,
                   p.title AS paper_title
            FROM defect_judgments j
            JOIN results r ON r.paper_id = j.paper_id
            LEFT JOIN papers p ON p.paper_id = j.paper_id
            ORDER BY j.paper_id, j.rule_id, j.created_at
            """
        ).fetchall()

    for r in rows:
        try:
            result = json.loads(r["result_json"])
        except Exception:
            continue
        defect = next(
            (d for d in result.get("defects", []) if d.get("id") == r["defect_id"]),
            None,
        )
        if defect is None:
            continue
        # Resolve evidence EDU text for self-contained export.
        edu_map = {
            e["id"]: e.get("text", "")
            for e in result.get("graph", {}).get("edus", [])
        }
        evidence_texts = [
            edu_map.get(eid, "") for eid in defect.get("evidence_edu_ids", [])
        ]
        out.append(
            {
                "paper_id": r["paper_id"],
                "paper_title": r["paper_title"],
                "defect_id": r["defect_id"],
                "rule_id": r["rule_id"],
                "verdict": r["verdict"],
                "note": r["note"],
                "judged_at": r["judged_at"],
                "defect": {
                    "id": defect.get("id"),
                    "rule_id": defect.get("rule_id"),
                    "defect_type": defect.get("defect_type"),
                    "severity": defect.get("severity"),
                    "section": defect.get("section"),
                    "confidence": defect.get("confidence"),
                    "description": defect.get("description"),
                    "suggestion": defect.get("suggestion"),
                    "evidence_edu_ids": defect.get("evidence_edu_ids", []),
                    "evidence_texts": evidence_texts,
                },
            }
        )

    return {
        "exported_at": _now(),
        "total_judgments": len(out),
        "items": out,
    }


def evaluation_summary() -> dict[str, Any]:
    """LLM verdict vs Human-as-judge accuracy breakdown.

    LLM flagged everything in results.defects (otherwise it wouldn't exist).
    Human judged each defect as correct / wrong / partial.

    Reports:
    - overall soft precision = (correct + 0.5×partial) / total
    - per-rule breakdown (always works — rule_id is in defect_judgments)
    - per-severity breakdown (needs result_json)
    - per-confidence-bucket breakdown (calibration check — high confidence
      defects should have higher precision than low confidence ones)

    Note on軟關聯: if a paper was deleted (kg.clear_paper + db.delete_paper),
    its result_json is gone but judgments remain. Those orphan judgments still
    contribute to overall / per-rule stats, but not to per-severity /
    per-confidence (where we need defect details from the JSON).
    """
    # Step 1: all judgments (for overall + per-rule, doesn't need result JSON)
    with connect() as c:
        all_judgments = c.execute(
            "SELECT paper_id, defect_id, rule_id, verdict FROM defect_judgments"
        ).fetchall()
    all_rows: list[dict[str, Any]] = [
        {"rule_id": j["rule_id"], "verdict": j["verdict"]} for j in all_judgments
    ]

    # Step 2: enrich with defect details for judgments whose result is still present
    rows_with_defect: list[dict[str, Any]] = []
    with connect() as c:
        joined = c.execute(
            """
            SELECT j.paper_id, j.defect_id, j.rule_id, j.verdict, r.result_json
            FROM defect_judgments j
            JOIN results r ON r.paper_id = j.paper_id
            """
        ).fetchall()
    for r in joined:
        try:
            result = json.loads(r["result_json"])
        except Exception:
            continue
        defect = next(
            (d for d in result.get("defects", []) if d.get("id") == r["defect_id"]),
            None,
        )
        if defect is None:
            continue
        rows_with_defect.append(
            {
                "rule_id": r["rule_id"],
                "verdict": r["verdict"],
                "severity": defect.get("severity"),
                "confidence": defect.get("confidence"),
            }
        )

    orphan_count = len(all_rows) - len(rows_with_defect)

    def _bucket(rows: list[dict[str, Any]]) -> dict[str, Any]:
        total = len(rows)
        correct = sum(1 for x in rows if x["verdict"] == "correct")
        wrong = sum(1 for x in rows if x["verdict"] == "wrong")
        partial = sum(1 for x in rows if x["verdict"] == "partial")
        precision = (
            round((correct + 0.5 * partial) / total, 4) if total > 0 else None
        )
        return {
            "total": total,
            "correct": correct,
            "wrong": wrong,
            "partial": partial,
            "soft_precision": precision,
        }

    # Overall + per-rule use ALL judgments (orphans still count)
    overall = _bucket(all_rows)

    by_rule_buckets: dict[str, list[dict[str, Any]]] = {}
    for x in all_rows:
        by_rule_buckets.setdefault(x["rule_id"], []).append(x)
    by_rule = [
        {"rule_id": rid, **_bucket(items)}
        for rid, items in sorted(by_rule_buckets.items())
    ]

    # Per-severity
    by_sev_buckets: dict[str, list[dict[str, Any]]] = {}
    for x in rows_with_defect:
        sev = x.get("severity") or "unknown"
        by_sev_buckets.setdefault(sev, []).append(x)
    severity_order = ["high", "medium", "low", "unknown"]
    by_severity = [
        {"severity": s, **_bucket(by_sev_buckets[s])}
        for s in severity_order
        if s in by_sev_buckets
    ]

    # Per-confidence bucket (calibration)
    conf_buckets: dict[str, list[dict[str, Any]]] = {
        "high (>=0.8)": [],
        "mid (0.5-0.8)": [],
        "low (<0.5)": [],
        "n/a": [],
    }
    for x in rows_with_defect:
        c_val = x.get("confidence")
        if c_val is None:
            conf_buckets["n/a"].append(x)
        elif c_val >= 0.8:
            conf_buckets["high (>=0.8)"].append(x)
        elif c_val >= 0.5:
            conf_buckets["mid (0.5-0.8)"].append(x)
        else:
            conf_buckets["low (<0.5)"].append(x)
    by_confidence = [
        {"bucket": b, **_bucket(items)}
        for b, items in conf_buckets.items()
        if len(items) > 0
    ]

    return {
        "overall": overall,
        "by_rule": by_rule,
        "by_severity": by_severity,
        "by_confidence": by_confidence,
        "orphan_judgments": orphan_count,  # 對應論文已刪，無法做 severity/confidence 分析
    }


def rule_firing_stats() -> dict[str, Any]:
    """Per-rule firing distribution across all analyzed papers.

    Returned shape (used by /api/rules/stats and the /stats page):
      {
        papers_analyzed: int,
        per_rule: {rule_id: {papers_fired, total_defects}},
      }
    Caller (routes) joins this with rule metadata + judgment_summary.
    """
    per_rule: dict[str, dict[str, int]] = {}
    papers_analyzed = 0
    with connect() as c:
        rows = c.execute("SELECT result_json FROM results").fetchall()
    for r in rows:
        try:
            res = json.loads(r["result_json"])
        except Exception:
            continue
        papers_analyzed += 1
        rules_in_paper: set[str] = set()
        for d in res.get("defects", []):
            rid = d.get("rule_id")
            if not rid:
                continue
            slot = per_rule.setdefault(rid, {"papers_fired": 0, "total_defects": 0})
            slot["total_defects"] += 1
            rules_in_paper.add(rid)
        for rid in rules_in_paper:
            per_rule[rid]["papers_fired"] += 1
    return {"papers_analyzed": papers_analyzed, "per_rule": per_rule}


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
