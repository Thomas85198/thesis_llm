"""FastAPI routes: upload paper → analyze → fetch graph, defects, PDF, EDU detail."""
from __future__ import annotations

import hashlib
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile
from fastapi.responses import FileResponse

from . import kg, pipeline, rules
from .schemas import AnalysisResult

router = APIRouter()

UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

JobStatus = Literal["queued", "extracting", "checking", "done", "error"]

_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()

# paper_id → saved PDF path (so /papers/{id}/pdf can serve it back to frontend)
_paper_files: dict[str, Path] = {}
_paper_files_lock = threading.Lock()

# paper_id → AnalysisResult dump (so result page can fetch by paper_id)
_paper_results: dict[str, dict[str, Any]] = {}
_paper_results_lock = threading.Lock()

# content SHA-256 → paper_id (so re-uploading the exact same file is instant)
_hash_to_paper_id: dict[str, str] = {}
_hash_lock = threading.Lock()


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
    content_hash: str | None = None,
) -> None:
    try:
        _set_job(job_id, status="extracting", message="Building EDU/ER/RST/FRU…")
        graph = pipeline.build_paper_graph(spans, title=title, paper_id=paper_id)
        kg.write_graph(graph)

        _set_job(job_id, status="checking", message="Running 13 REL rules…")
        defects = rules.check_all_rules(paper_id, paper_title=title)

        result = AnalysisResult(paper_id=paper_id, graph=graph, defects=defects)
        result_dump = result.model_dump()
        with _paper_results_lock:
            _paper_results[paper_id] = result_dump
        _set_job(
            job_id,
            status="done",
            result=result_dump,
            finished_at=datetime.now(timezone.utc).isoformat(),
        )
        # Register content-hash → paper_id only after a fully successful run.
        if content_hash:
            with _hash_lock:
                _hash_to_paper_id[content_hash] = paper_id
    except Exception as exc:
        try:
            kg.clear_paper(paper_id)
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

    # Cache hit: same file already analyzed → return existing paper_id
    # as an instantly-done job, no LLM cost incurred.
    with _hash_lock:
        cached_paper_id = _hash_to_paper_id.get(content_hash)
    if cached_paper_id:
        with _paper_results_lock:
            cached_result = _paper_results.get(cached_paper_id)
        if cached_result is not None:
            now = datetime.now(timezone.utc).isoformat()
            job_id = f"job:{uuid.uuid4().hex[:8]}"
            _set_job(
                job_id,
                status="done",
                paper_id=cached_paper_id,
                title=cached_result.get("graph", {}).get("title", file.filename),
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
    with _paper_files_lock:
        _paper_files[paper_id] = saved_path

    spans = pipeline.extract_spans_from_bytes(raw, file.filename)
    if not spans:
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
        content_hash,
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
    with _paper_files_lock:
        path = _paper_files.get(paper_id)
    if path is None or not path.exists():
        raise HTTPException(404, "PDF not found for this paper")
    return FileResponse(path, media_type="application/pdf")


@router.get("/api/papers/{paper_id}/result")
def paper_result(paper_id: str) -> dict[str, Any]:
    with _paper_results_lock:
        result = _paper_results.get(paper_id)
    if result is None:
        raise HTTPException(404, "Result not found (server may have restarted)")
    return result


@router.get("/api/papers")
def list_papers() -> list[dict[str, Any]]:
    with _paper_results_lock:
        items = [
            {
                "paper_id": pid,
                "title": r.get("graph", {}).get("title", ""),
                "defect_count": len(r.get("defects", [])),
                "edu_count": len(r.get("graph", {}).get("edus", [])),
            }
            for pid, r in _paper_results.items()
        ]
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
