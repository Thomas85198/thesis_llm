"""SQLite persistence: papers, results, content-hash cache, LLM call log.

Single-file DB. Path is env-controlled for Docker / lab server deployment:
  SQLITE_PATH=...     # full path wins
  DATA_DIR=...        # else <DATA_DIR>/data.db
  (else)              # else backend/data.db (local dev fallback)
WAL journal mode is enabled in connect() so multiple FastAPI workers can read
while one writes without blocking each other.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


def _resolve_db_path() -> Path:
    explicit = os.getenv("SQLITE_PATH")
    if explicit:
        return Path(explicit)
    data_dir = os.getenv("DATA_DIR")
    if data_dir:
        return Path(data_dir) / "data.db"
    return Path(__file__).parent.parent / "data.db"


DB_PATH = _resolve_db_path()

_init_lock = threading.Lock()
_initialized = False


SCHEMA = """
-- ============================================================
-- 表 1: papers — 論文中繼資料 + 上傳去重快取
-- ----------------------------------------------------------------
-- 每筆代表使用者上傳過的一篇論文。content_hash 是 SHA-256，
-- 用來偵測「同一份檔案是否上傳過」，命中即直接回傳之前的 paper_id
-- 不重跑 LLM。pdf_path 記錄的是相對於 UPLOAD_DIR 的 basename
-- (e.g. "paper_3ecdd642.pdf")，讀取時 routes._resolve_pdf_path() 會
-- 接上 UPLOAD_DIR。舊資料若還是絕對路徑，resolver 會 fallback 直接回傳。
-- ============================================================
CREATE TABLE IF NOT EXISTS papers (
    paper_id      TEXT PRIMARY KEY,    -- 論文唯一識別 (格式 'paper:xxxxxxxx')
    title         TEXT,                -- 論文標題（使用者上傳時填的；可為空）
    filename      TEXT,                -- 原始檔名 (e.g. "2017_Vaswani.pdf")，永遠記下
    content_hash  TEXT,                -- 檔案 SHA-256，用於上傳去重
    pdf_path      TEXT,                -- PDF basename 相對於 UPLOAD_DIR
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

-- ============================================================
-- 表 5: documents — 編輯模式的寫作文件 (WYSIWYG 草稿)
-- ----------------------------------------------------------------
-- 全新「編輯模式」的核心：使用者從零寫論文，內容以 TipTap/ProseMirror
-- 的 JSON 序列化格式存在 content_json。與分析流的 papers 表完全獨立
-- (那是「上傳既有 PDF 分析」，這是「從頭寫」)。目前無帳號系統，文件
-- 不歸屬使用者；locale 記錄該文件的寫作語言 (沿用 i18n 的 zh-Hant/en)。
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
    doc_id        TEXT PRIMARY KEY,    -- 文件唯一識別 (格式 'doc:xxxxxxxx')
    title         TEXT NOT NULL,       -- 文件標題 (可為使用者輸入或預設「未命名文件」)
    content_json  TEXT NOT NULL,       -- TipTap/ProseMirror document JSON
    locale        TEXT NOT NULL,       -- 寫作語言 (zh-Hant / en)
    created_at    TEXT NOT NULL,       -- 建立時間 (ISO 8601 UTC)
    updated_at    TEXT NOT NULL        -- 最後 autosave 時間 (ISO 8601 UTC)
);
CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at);

-- ============================================================
-- 表 6: document_versions — 文件版本快照 (版本歷史 / 還原)
-- ----------------------------------------------------------------
-- 每筆是某文件在某時間點的內容快照。label 區分自動存檔 ('autosave')
-- 與使用者手動命名版。透過 ON DELETE CASCADE 與 documents 綁定
-- (刪文件會連帶刪所有快照)。autosave 版會定期裁剪 (見 prune_autosave_versions)，
-- 手動命名版永久保留。
-- ============================================================
CREATE TABLE IF NOT EXISTS document_versions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id        TEXT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
    content_json  TEXT NOT NULL,       -- 該版完整快照 (ProseMirror JSON)
    label         TEXT NOT NULL,       -- 'autosave' 或使用者命名 (e.g. '初稿完成')
    created_at    TEXT NOT NULL        -- 快照時間 (ISO 8601 UTC)
);
CREATE INDEX IF NOT EXISTS idx_doc_versions_doc ON document_versions(doc_id, created_at);

-- ============================================================
-- 表 7: paper_chunks — 引用論文全文切句 + 向量快取 (全文句級接地)
-- ----------------------------------------------------------------
-- 每筆是某 OpenAlex 論文全文(或摘要)切出的一句 + 其 embedding (JSON 浮點陣列)。
-- 用於「點引用→看原文哪一句支撐你」:抓 OA 全文→切句→embed 後存這裡,
-- 之後同一篇直接重用、不重抓不重 embed。source 標記是全文還是退回摘要。
-- ============================================================
CREATE TABLE IF NOT EXISTS paper_chunks (
    openalex_id TEXT NOT NULL,           -- 論文識別 (e.g. 'W2626778328')
    idx         INTEGER NOT NULL,        -- 句子在文中的序
    text        TEXT NOT NULL,           -- 句子文字
    embedding   TEXT NOT NULL,           -- JSON 浮點陣列 (embedding 向量)
    source      TEXT NOT NULL,           -- 'fulltext' | 'abstract'
    PRIMARY KEY (openalex_id, idx)
);

-- ============================================================
-- 表 8: upload_events — 每次上傳的持久化稽核軌跡 (失敗追蹤)
-- ----------------------------------------------------------------
-- 每筆對應使用者按下「開始分析」的一次上傳。和 papers 表的差別:
-- papers 在分析「失敗」時會被 delete_paper 清掉 (避免污染歷史列表)，
-- 但 upload_events **永遠保留**，所以維護者事後仍查得到「老師傳了什麼
-- 檔、錯在哪個階段、什麼錯誤」。失敗的 PDF 也不刪 (留在 UPLOAD_DIR)，
-- pdf_path 記 basename 供後台下載重現。狀態流:
--   pending → done   (分析成功)
--   pending → error  (分析拋例外；error_* 欄位填入)
--   cached           (同檔之前已分析過，直接命中快取，不重跑)
-- 這張表獨立於 papers，delete_paper 不會碰它。
-- ============================================================
CREATE TABLE IF NOT EXISTS upload_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id        TEXT NOT NULL,        -- 對應記憶體 job (format 'job:xxxxxxxx')
    paper_id      TEXT,                 -- 對應 paper (失敗清除後仍留此 id 字串)
    filename      TEXT,                 -- 使用者上傳的原始檔名
    file_size     INTEGER,             -- 上傳位元組大小
    content_hash  TEXT,                 -- 檔案 SHA-256 (對照去重)
    status        TEXT NOT NULL CHECK (status IN ('pending','done','error','cached')),
    error_type    TEXT,                 -- 例外類別名 (e.g. 'RuntimeError')
    error_stage   TEXT,                 -- 失敗階段 (extracting/title/graph/checking)
    error_message TEXT,                 -- repr(exc) 全文
    pdf_path      TEXT,                 -- PDF basename 相對 UPLOAD_DIR (反查/下載)
    created_at    TEXT NOT NULL,        -- 上傳時間 (ISO 8601 UTC)
    finished_at   TEXT                  -- 完成/失敗時間 (ISO 8601 UTC)
);
CREATE INDEX IF NOT EXISTS idx_upload_events_status ON upload_events(status);
CREATE INDEX IF NOT EXISTS idx_upload_events_created ON upload_events(created_at);
CREATE INDEX IF NOT EXISTS idx_upload_events_job ON upload_events(job_id);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _migrate(conn: sqlite3.Connection) -> None:
    """Idempotent schema migrations for existing DBs.

    SQLite doesn't have ALTER TABLE ADD COLUMN IF NOT EXISTS, so we check
    PRAGMA table_info first. Each migration must be safe to re-run.
    """
    # Migration 1 (2026-05-11): papers.filename
    # Old schema had only `title`; uploads used `title or filename` so the
    # column was ambiguous (could be user-input or original filename).
    # Add a dedicated `filename` column and backfill from existing title.
    cols = {row[1] for row in conn.execute("PRAGMA table_info(papers)").fetchall()}
    if "filename" not in cols:
        conn.execute("ALTER TABLE papers ADD COLUMN filename TEXT")
        # Backfill: assume existing title (if it ends with a file extension)
        # was originally a filename. Move that to filename and clear title
        # so the row falls back to filename display naturally.
        conn.execute(
            """
            UPDATE papers
            SET filename = title
            WHERE filename IS NULL AND title IS NOT NULL
            """
        )


def _ensure_init() -> None:
    global _initialized
    if _initialized:
        return
    with _init_lock:
        if _initialized:
            return
        # Make sure the parent dir exists when SQLITE_PATH points at /data/data.db
        # on a freshly-mounted Docker volume.
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(DB_PATH) as conn:
            # WAL allows readers and one writer concurrently — safer for multi-worker
            # uvicorn / reload than the default rollback journal. Set once on first
            # connection; it's a persistent file-level setting.
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.executescript(SCHEMA)
            _migrate(conn)
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
    paper_id: str,
    title: str,
    filename: str,
    content_hash: str,
    pdf_path: str,
) -> None:
    """Insert or update a paper. title can be empty; filename should always be set."""
    with connect() as c:
        c.execute(
            """
            INSERT INTO papers (paper_id, title, filename, content_hash, pdf_path, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(paper_id) DO UPDATE SET
                title=excluded.title,
                filename=excluded.filename,
                content_hash=excluded.content_hash,
                pdf_path=excluded.pdf_path
            """,
            (paper_id, title, filename, content_hash, pdf_path, _now()),
        )


def update_paper_title(paper_id: str, title: str) -> None:
    """Set the paper's title after LLM auto-detection (when the user left it blank)."""
    with connect() as c:
        c.execute("UPDATE papers SET title=? WHERE paper_id=?", (title, paper_id))


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
            SELECT p.paper_id, p.title, p.filename, p.created_at,
                   r.result_json IS NOT NULL AS has_result,
                   r.finished_at
            FROM papers p
            LEFT JOIN results r ON r.paper_id = p.paper_id
            ORDER BY COALESCE(r.finished_at, p.created_at) DESC
            """
        ).fetchall()
    return [dict(r) for r in rows]


def delete_paper(paper_id: str) -> None:
    """Fully remove a paper and ALL rows associated with it.

    `results` cascades automatically via its FK. `defect_judgments` and
    `llm_calls` have no FK (SQLite can't add one without a table rebuild),
    so wipe them explicitly — in the same transaction — so /stats precision
    and /api/cost totals only ever reflect papers that still exist.
    """
    with connect() as c:
        c.execute("DELETE FROM defect_judgments WHERE paper_id=?", (paper_id,))
        c.execute("DELETE FROM llm_calls WHERE paper_id=?", (paper_id,))
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


# ---------- upload events (persistent upload audit trail) ----------

def log_upload_start(
    *,
    job_id: str,
    paper_id: str | None,
    filename: str | None,
    file_size: int | None,
    content_hash: str | None,
    pdf_path: str | None,
    status: str = "pending",
) -> None:
    """Record an upload the moment the file lands on disk.

    Written BEFORE analysis runs so that even a crash mid-analysis leaves a
    persistent trace (papers row may get deleted on failure; this one never is).
    """
    with connect() as c:
        c.execute(
            """
            INSERT INTO upload_events
                (job_id, paper_id, filename, file_size, content_hash,
                 status, pdf_path, created_at, finished_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                paper_id,
                filename,
                file_size,
                content_hash,
                status,
                pdf_path,
                _now(),
                _now() if status in ("done", "cached") else None,
            ),
        )


def mark_upload_done(job_id: str) -> None:
    with connect() as c:
        c.execute(
            "UPDATE upload_events SET status='done', finished_at=? WHERE job_id=?",
            (_now(), job_id),
        )


def mark_upload_failed(
    job_id: str, error_type: str, error_stage: str, error_message: str
) -> None:
    with connect() as c:
        c.execute(
            """
            UPDATE upload_events
            SET status='error', error_type=?, error_stage=?, error_message=?,
                finished_at=?
            WHERE job_id=?
            """,
            (error_type, error_stage, error_message, _now(), job_id),
        )


def list_upload_events(
    limit: int = 100, status: str | None = None
) -> list[dict[str, Any]]:
    """Most-recent-first upload events for the admin dashboard."""
    with connect() as c:
        if status:
            rows = c.execute(
                """
                SELECT * FROM upload_events WHERE status=?
                ORDER BY created_at DESC LIMIT ?
                """,
                (status, limit),
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM upload_events ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
    return [dict(r) for r in rows]


def get_upload_event(event_id: int) -> dict[str, Any] | None:
    with connect() as c:
        row = c.execute(
            "SELECT * FROM upload_events WHERE id=?", (event_id,)
        ).fetchone()
    return dict(row) if row else None


def upload_stats_since(iso_ts: str) -> dict[str, Any]:
    """Aggregate uploads since iso_ts (for the daily summary email).

    Returns {total, by_status: {...}, failures: [{filename, error_type,
    error_stage, error_message, created_at}, ...]}.
    """
    with connect() as c:
        counts = c.execute(
            """
            SELECT status, COUNT(*) AS n FROM upload_events
            WHERE created_at >= ? GROUP BY status
            """,
            (iso_ts,),
        ).fetchall()
        failures = c.execute(
            """
            SELECT filename, error_type, error_stage, error_message, created_at
            FROM upload_events
            WHERE created_at >= ? AND status='error'
            ORDER BY created_at DESC
            """,
            (iso_ts,),
        ).fetchall()
    by_status = {r["status"]: r["n"] for r in counts}
    return {
        "total": sum(by_status.values()),
        "by_status": by_status,
        "failures": [dict(r) for r in failures],
    }


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

    Note on orphans: delete_paper() now wipes a paper's judgments too, so
    fresh deletes leave no orphans. But a DB may still hold orphan judgments
    from before that change — judgments whose result_json is gone. Those
    still contribute to overall / per-rule stats, but not to per-severity /
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


# ---------- editor documents (寫作模式) ----------

# Keep at most this many autosave snapshots per document; older ones are pruned
# on each new autosave. Manually-labelled versions are never pruned. Prevents
# the version table from growing unbounded under frequent debounced autosaves.
MAX_AUTOSAVE_VERSIONS = 20


def create_document(
    doc_id: str, title: str, content_json: dict[str, Any], locale: str
) -> dict[str, Any]:
    """Insert a new blank/seeded writing document. Returns the stored row."""
    now = _now()
    with connect() as c:
        c.execute(
            """
            INSERT INTO documents (doc_id, title, content_json, locale, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (doc_id, title, json.dumps(content_json, ensure_ascii=False), locale, now, now),
        )
    return {
        "doc_id": doc_id,
        "title": title,
        "content_json": content_json,
        "locale": locale,
        "created_at": now,
        "updated_at": now,
    }


def get_document(doc_id: str) -> dict[str, Any] | None:
    with connect() as c:
        row = c.execute(
            "SELECT * FROM documents WHERE doc_id=?", (doc_id,)
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    d["content_json"] = json.loads(d["content_json"])
    return d


def list_documents() -> list[dict[str, Any]]:
    """List documents (most recently updated first), without the heavy content blob."""
    with connect() as c:
        rows = c.execute(
            """
            SELECT doc_id, title, locale, created_at, updated_at
            FROM documents
            ORDER BY updated_at DESC
            """
        ).fetchall()
    return [dict(r) for r in rows]


def update_document(
    doc_id: str,
    title: str | None = None,
    content_json: dict[str, Any] | None = None,
) -> bool:
    """Patch title and/or content; bumps updated_at. Returns False if doc absent.

    Only the provided fields are written, so an autosave (content only) won't
    clobber a title the user just renamed, and vice versa.
    """
    sets: list[str] = []
    vals: list[Any] = []
    if title is not None:
        sets.append("title=?")
        vals.append(title)
    if content_json is not None:
        sets.append("content_json=?")
        vals.append(json.dumps(content_json, ensure_ascii=False))
    if not sets:
        return get_document(doc_id) is not None
    sets.append("updated_at=?")
    vals.append(_now())
    vals.append(doc_id)
    with connect() as c:
        cur = c.execute(
            f"UPDATE documents SET {', '.join(sets)} WHERE doc_id=?", vals
        )
        return cur.rowcount > 0


def delete_document(doc_id: str) -> None:
    """Remove a document; document_versions cascade via FK."""
    with connect() as c:
        c.execute("DELETE FROM documents WHERE doc_id=?", (doc_id,))


def snapshot_document(
    doc_id: str, content_json: dict[str, Any], label: str = "autosave"
) -> int:
    """Save a version snapshot. Autosave snapshots are pruned to the most recent
    MAX_AUTOSAVE_VERSIONS; labelled versions are kept forever. Returns the new id."""
    with connect() as c:
        cur = c.execute(
            """
            INSERT INTO document_versions (doc_id, content_json, label, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (doc_id, json.dumps(content_json, ensure_ascii=False), label, _now()),
        )
        new_id = cur.lastrowid
        if label == "autosave":
            # Delete autosave rows beyond the newest MAX_AUTOSAVE_VERSIONS.
            c.execute(
                """
                DELETE FROM document_versions
                WHERE doc_id=? AND label='autosave' AND id NOT IN (
                    SELECT id FROM document_versions
                    WHERE doc_id=? AND label='autosave'
                    ORDER BY id DESC LIMIT ?
                )
                """,
                (doc_id, doc_id, MAX_AUTOSAVE_VERSIONS),
            )
    return int(new_id)


def list_document_versions(doc_id: str) -> list[dict[str, Any]]:
    """Version metadata (no content blob), newest first."""
    with connect() as c:
        rows = c.execute(
            """
            SELECT id, label, created_at
            FROM document_versions
            WHERE doc_id=?
            ORDER BY id DESC
            """,
            (doc_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_document_version(doc_id: str, version_id: int) -> dict[str, Any] | None:
    with connect() as c:
        row = c.execute(
            "SELECT id, doc_id, content_json, label, created_at "
            "FROM document_versions WHERE id=? AND doc_id=?",
            (version_id, doc_id),
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    d["content_json"] = json.loads(d["content_json"])
    return d


# ---------- paper_chunks (full-text grounding cache) ----------

def get_paper_chunks(openalex_id: str) -> list[dict[str, Any]]:
    """Cached sentence chunks + embeddings for a paper, in order. [] if none."""
    with connect() as c:
        rows = c.execute(
            "SELECT idx, text, embedding, source FROM paper_chunks "
            "WHERE openalex_id=? ORDER BY idx",
            (openalex_id,),
        ).fetchall()
    return [
        {"idx": r["idx"], "text": r["text"],
         "embedding": json.loads(r["embedding"]), "source": r["source"]}
        for r in rows
    ]


def upsert_paper_chunks(
    openalex_id: str, source: str, chunks: list[tuple[int, str, list[float]]]
) -> None:
    """Replace the cached chunks for a paper. chunks = [(idx, text, embedding)]."""
    with connect() as c:
        c.execute("DELETE FROM paper_chunks WHERE openalex_id=?", (openalex_id,))
        c.executemany(
            "INSERT INTO paper_chunks(openalex_id, idx, text, embedding, source) "
            "VALUES(?,?,?,?,?)",
            [(openalex_id, i, t, json.dumps(e), source) for (i, t, e) in chunks],
        )
