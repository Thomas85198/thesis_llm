"""Ablation 實驗的語料層：跨多個 SQLite DB 撈已分析論文。

刻意「不」走 app.db（它綁定單一模組級 DB_PATH），而是自己開 sqlite3 連線，
這樣同一支 harness 能同時讀 backend/data.db（2 篇、有 PDF）與根目錄
thesis-data.db（4 篇、只有歷史 result_json）。

每篇論文提供兩條取用路徑：
- cache：直接讀 results.result_json（含 graph 的 edus/fru/er + 完整 pipeline 的 defects）。
  → Arm A 全文 = 拼 edus、Arm C 輸入 = graph、Arm B 輸出 = defects。零成本、免 PDF/neo4j。
- fresh：讀 papers.pdf_path → uploads 下的 PDF bytes，供三 arm 從頭重跑（只有 data.db 那 2 篇有檔）。
"""

from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path

# backend/ 根目錄（experiments/ 的上一層）
_BACKEND = Path(__file__).resolve().parent.parent
# 預設掃這兩個 DB；可用 ABLATION_DBS 環境變數（冒號分隔）覆蓋。
_DEFAULT_DBS = [_BACKEND / "data.db", _BACKEND.parent / "thesis-data.db"]


def _upload_dir() -> Path:
    explicit = os.getenv("UPLOAD_DIR")
    if explicit:
        return Path(explicit)
    data_dir = os.getenv("DATA_DIR")
    if data_dir:
        return Path(data_dir) / "uploads"
    return _BACKEND / "uploads"


def db_paths() -> list[Path]:
    env = os.getenv("ABLATION_DBS")
    if env:
        return [Path(p) for p in env.split(":") if p]
    return [p for p in _DEFAULT_DBS if p.exists()]


@dataclass
class CorpusItem:
    paper_id: str
    title: str
    filename: str
    db_path: Path
    has_result: bool
    pdf_path: Path | None  # 解析後的絕對路徑；None = uploads 找不到檔

    @property
    def label(self) -> str:
        return self.title or self.filename or self.paper_id

    @property
    def can_fresh(self) -> bool:
        return self.pdf_path is not None


def _resolve_pdf(pdf_path: str | None, filename: str | None) -> Path | None:
    up = _upload_dir()
    for cand in (pdf_path, filename):
        if cand:
            p = up / Path(cand).name
            if p.exists():
                return p
    return None


def list_corpus(paths: list[Path] | None = None) -> list[CorpusItem]:
    """列出所有 DB 裡有 result_json 的論文（去重：同 paper_id 取第一個 DB）。"""
    items: list[CorpusItem] = []
    seen: set[str] = set()
    for db in paths or db_paths():
        if not db.exists():
            continue
        conn = sqlite3.connect(db)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                """
                SELECT p.paper_id, p.title, p.filename, p.pdf_path,
                       (r.result_json IS NOT NULL) AS has_result
                FROM papers p
                LEFT JOIN results r ON r.paper_id = p.paper_id
                """
            ).fetchall()
        finally:
            conn.close()
        for row in rows:
            pid = row["paper_id"]
            if pid in seen or not row["has_result"]:
                continue
            seen.add(pid)
            items.append(
                CorpusItem(
                    paper_id=pid,
                    title=row["title"] or "",
                    filename=row["filename"] or "",
                    db_path=db,
                    has_result=bool(row["has_result"]),
                    pdf_path=_resolve_pdf(row["pdf_path"], row["filename"]),
                )
            )
    return items


def load_result(item: CorpusItem) -> dict:
    """取該篇的完整 AnalysisResult dict（graph + defects）。"""
    conn = sqlite3.connect(item.db_path)
    try:
        row = conn.execute(
            "SELECT result_json FROM results WHERE paper_id = ?", (item.paper_id,)
        ).fetchone()
    finally:
        conn.close()
    if not row or not row[0]:
        raise ValueError(f"{item.paper_id} 在 {item.db_path.name} 沒有 result_json")
    return json.loads(row[0])


def full_text(graph: dict) -> str:
    """把 graph.edus 依原順序拼成全文純文字（Arm A 的輸入）。"""
    return "\n".join(e.get("text", "") for e in graph.get("edus", []))


def pdf_bytes(item: CorpusItem) -> bytes:
    if not item.pdf_path:
        raise ValueError(f"{item.paper_id} 沒有可用 PDF（fresh 模式不可用）")
    return item.pdf_path.read_bytes()


def _main() -> None:
    items = list_corpus()
    print(f"可用語料：{len(items)} 篇\n")
    print(f"{'paper_id':<18}{'PDF':<6}{'DB':<18}標題/檔名")
    print("-" * 80)
    for it in items:
        print(
            f"{it.paper_id:<18}{'✓' if it.can_fresh else '–':<6}"
            f"{it.db_path.name:<18}{it.label}"
        )
    fresh = sum(1 for it in items if it.can_fresh)
    print(f"\ncache 模式可跑：{len(items)} 篇；fresh 模式（有 PDF）：{fresh} 篇")


if __name__ == "__main__":
    _main()
