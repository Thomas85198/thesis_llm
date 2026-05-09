"""FastAPI routes: upload paper → analyze → fetch graph, defects, PDF, EDU detail, cost."""
from __future__ import annotations

import hashlib
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import db, kg, pipeline, rules
from .schemas import AnalysisResult


class JudgmentIn(BaseModel):
    defect_id: str
    rule_id: str
    verdict: str = Field(..., pattern="^(correct|wrong|partial)$")
    note: str | None = None

router = APIRouter()

UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

JobStatus = Literal["queued", "extracting", "checking", "done", "error"]

# Job state stays in-memory: it only matters during a single analysis run.
# Papers / results / hash-cache / cost log all live in SQLite (app/db.py).
_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _set_job(job_id: str, **fields: Any) -> None:
    with _jobs_lock:
        _jobs.setdefault(job_id, {}).update(fields)


def _get_job(job_id: str) -> dict[str, Any] | None:
    with _jobs_lock:
        j = _jobs.get(job_id)
        return None if j is None else dict(j)


def _run_analysis(
    job_id: str,
    paper_id: str,
    title: str,
    spans: list[pipeline.Span],
) -> None:
    try:
        _set_job(job_id, status="extracting", message="Building EDU/ER/RST/FRU…")
        graph = pipeline.build_paper_graph(spans, title=title, paper_id=paper_id)
        kg.write_graph(graph)

        _set_job(job_id, status="checking", message="Running 13 REL rules…")
        defects = rules.check_all_rules(paper_id, paper_title=title)

        result = AnalysisResult(paper_id=paper_id, graph=graph, defects=defects)
        result_dump = result.model_dump()
        db.upsert_result(paper_id, result_dump)
        _set_job(
            job_id,
            status="done",
            result=result_dump,
            finished_at=datetime.now(timezone.utc).isoformat(),
        )
    except Exception as exc:
        try:
            kg.clear_paper(paper_id)
            db.delete_paper(paper_id)
        except Exception as cleanup_exc:
            _set_job(
                job_id,
                status="error",
                error=f"{exc!r} (cleanup also failed: {cleanup_exc!r})",
            )
        else:
            _set_job(job_id, status="error", error=repr(exc))


@router.post("/api/upload")
async def upload(
    file: UploadFile, background: BackgroundTasks, title: str = ""
) -> dict[str, Any]:
    if not file.filename:
        raise HTTPException(400, "missing filename")

    raw = await file.read()
    content_hash = hashlib.sha256(raw).hexdigest()

    # Cache hit: same file already analyzed (persistent across restarts).
    cached = db.get_paper_by_hash(content_hash)
    if cached:
        cached_paper_id = cached["paper_id"]
        cached_result = db.get_result(cached_paper_id)
        if cached_result is not None:
            now = datetime.now(timezone.utc).isoformat()
            job_id = f"job:{uuid.uuid4().hex[:8]}"
            _set_job(
                job_id,
                status="done",
                paper_id=cached_paper_id,
                title=cached["title"],
                created_at=now,
                finished_at=now,
                message="Cached (same file already analyzed).",
                result=cached_result,
            )
            return {
                "job_id": job_id,
                "paper_id": cached_paper_id,
                "cached": True,
            }

    paper_id = f"paper:{uuid.uuid4().hex[:8]}"
    suffix = Path(file.filename).suffix or ".pdf"
    saved_path = UPLOAD_DIR / f"{paper_id.replace(':', '_')}{suffix}"
    saved_path.write_bytes(raw)
    db.upsert_paper(paper_id, title or file.filename, content_hash, str(saved_path))

    spans = pipeline.extract_spans_from_bytes(raw, file.filename)
    if not spans:
        db.delete_paper(paper_id)
        raise HTTPException(400, "empty document")

    job_id = f"job:{uuid.uuid4().hex[:8]}"
    _set_job(
        job_id,
        status="queued",
        paper_id=paper_id,
        title=title or file.filename,
        created_at=datetime.now(timezone.utc).isoformat(),
        message="Queued.",
    )
    background.add_task(
        _run_analysis,
        job_id,
        paper_id,
        title or file.filename,
        spans,
    )
    return {"job_id": job_id, "paper_id": paper_id, "cached": False}


@router.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict[str, Any]:
    job = _get_job(job_id)
    if job is None:
        raise HTTPException(404, "unknown job")
    return job


@router.get("/api/papers/{paper_id}/pdf")
def paper_pdf(paper_id: str) -> FileResponse:
    paper = db.get_paper(paper_id)
    if paper is None or not paper.get("pdf_path"):
        raise HTTPException(404, "PDF not found for this paper")
    path = Path(paper["pdf_path"])
    if not path.exists():
        raise HTTPException(404, "PDF file missing on disk")
    return FileResponse(path, media_type="application/pdf")


@router.get("/api/papers/{paper_id}/result")
def paper_result(paper_id: str) -> dict[str, Any]:
    result = db.get_result(paper_id)
    if result is None:
        raise HTTPException(404, "Result not found")
    return result


@router.get("/api/papers")
def list_papers() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for p in db.list_papers():
        if not p.get("has_result"):
            continue
        result = db.get_result(p["paper_id"])
        if result is None:
            continue
        items.append({
            "paper_id": p["paper_id"],
            "title": p["title"] or result.get("graph", {}).get("title", ""),
            "defect_count": len(result.get("defects", [])),
            "edu_count": len(result.get("graph", {}).get("edus", [])),
            "finished_at": p.get("finished_at"),
        })
    return items


@router.get("/api/papers/{paper_id}/graph")
def paper_graph(paper_id: str) -> dict[str, Any]:
    return kg.fetch_graph_for_viz(paper_id)


@router.get("/api/papers/{paper_id}/edus/{edu_id:path}")
def edu_detail(paper_id: str, edu_id: str) -> dict[str, Any]:
    rows = kg.run_cypher(
        """
        MATCH (e:EDU {id: $eid, paper_id: $pid})
        RETURN e.id AS id, e.text AS text, e.section AS section,
               e.order AS order, e.page AS page, e.bbox AS bbox
        """,
        eid=edu_id,
        pid=paper_id,
    )
    if not rows:
        raise HTTPException(404, "EDU not found")
    return rows[0]


@router.get("/api/rules")
def list_rules() -> list[dict[str, Any]]:
    return [
        {"id": r["id"], "name": r["name"], "description": r["description"]}
        for r in rules.load_rules()
    ]


@router.get("/api/cost")
def overall_cost() -> dict[str, Any]:
    """Total spending + per-stage breakdown across all papers."""
    return db.cost_summary(paper_id=None)


@router.get("/api/papers/{paper_id}/cost")
def paper_cost(paper_id: str) -> dict[str, Any]:
    """Spending breakdown for a single paper."""
    return db.cost_summary(paper_id=paper_id)


# ---------- human-as-judge evaluation ----------

@router.get("/api/papers/{paper_id}/judgments")
def list_judgments(paper_id: str) -> list[dict[str, Any]]:
    return db.list_judgments(paper_id)


@router.post("/api/papers/{paper_id}/judgments")
def upsert_judgment(paper_id: str, body: JudgmentIn) -> dict[str, str]:
    db.upsert_judgment(
        paper_id=paper_id,
        defect_id=body.defect_id,
        rule_id=body.rule_id,
        verdict=body.verdict,
        note=body.note,
    )
    return {"status": "ok"}


@router.delete("/api/papers/{paper_id}/judgments/{defect_id:path}")
def delete_judgment(paper_id: str, defect_id: str) -> dict[str, str]:
    db.delete_judgment(paper_id, defect_id)
    return {"status": "ok"}


@router.get("/api/judgments/summary")
def judgments_summary() -> dict[str, Any]:
    """Per-rule + global precision based on accumulated human judgments."""
    return db.judgment_summary()
