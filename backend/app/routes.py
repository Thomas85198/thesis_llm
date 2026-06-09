"""FastAPI routes: upload paper → analyze → fetch graph, defects, PDF, EDU detail, cost."""
from __future__ import annotations

import hashlib
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from . import autocomplete as autocomplete_mod
from . import chat as chat_mod
from . import citation as citation_mod
from . import citation_relink as citation_relink_mod
from . import claim_verifier as claim_verifier_mod
from . import draft_check as draft_check_mod
from . import export_doc
from . import import_doc
from . import grounding as grounding_mod
from . import outline as outline_mod
from . import rewrite as rewrite_mod
from . import db, kg, pipeline, rules
from .schemas import AnalysisResult


class JudgmentIn(BaseModel):
    defect_id: str
    rule_id: str
    verdict: str = Field(..., pattern="^(correct|wrong|partial)$")
    note: str | None = None


class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str


class ChatIn(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1, max_length=40)
    lang: str | None = None  # UI locale; assistant reads context + replies in it


# ---------- editor mode (寫作模式) request bodies ----------

# A blank TipTap/ProseMirror document — one empty paragraph. Used as the seed
# content when a new document is created without explicit content.
EMPTY_DOC: dict[str, Any] = {"type": "doc", "content": [{"type": "paragraph"}]}


class DocumentCreateIn(BaseModel):
    title: str = Field("", max_length=300)
    locale: str = Field("zh-Hant", pattern="^(zh-Hant|en)$")
    content_json: dict[str, Any] | None = None


class DocumentUpdateIn(BaseModel):
    """Partial patch — autosave sends content only; rename sends title only."""
    title: str | None = Field(None, max_length=300)
    content_json: dict[str, Any] | None = None


class VersionCreateIn(BaseModel):
    content_json: dict[str, Any]
    label: str = Field("autosave", max_length=120)


class AutocompleteIn(BaseModel):
    doc_id: str
    text_before: str = Field(..., max_length=20000)  # capped again server-side
    title: str = Field("", max_length=300)
    outline: str = Field("", max_length=4000)
    locale: str = Field("zh-Hant", pattern="^(zh-Hant|en)$")


class CitationRecommendIn(BaseModel):
    doc_id: str
    claim: str = Field(..., max_length=2000)  # the selected sentence to cite
    locale: str | None = None  # reserved; OpenAlex search is language-agnostic
    year_from: int | None = Field(None, ge=1900, le=2100)  # optional recency filter


class CitationRefreshIn(BaseModel):
    openalex_ids: list[str] = Field(..., max_length=100)  # ids of the doc's citations


class CitationRelinkIn(BaseModel):
    doc_id: str
    content_json: dict[str, Any]  # the live doc; references parsed + in-text markers linked


class CitationVerifyIn(BaseModel):
    doc_id: str
    claim: str = Field(..., max_length=2000)  # the sentence to support
    title: str = Field("", max_length=500)  # candidate source title (context)
    abstract: str = Field("", max_length=8000)  # candidate abstract (already on the client)
    openalex_id: str | None = None  # references-tab path: re-fetch abstract by id
    locale: str | None = None


class CitationGroundIn(BaseModel):
    doc_id: str
    openalex_id: str = Field(..., max_length=40)
    oa_url: str = Field("", max_length=2000)  # OA full text URL (may be "")
    claim: str = Field(..., max_length=2000)


class DraftCheckIn(BaseModel):
    doc_id: str
    text: str = Field(..., min_length=1, max_length=20000)  # the draft to check
    locale: str | None = None


class RewriteIn(BaseModel):
    doc_id: str
    text: str = Field(..., min_length=1, max_length=4000)  # the selected passage
    instruction: str = Field(..., max_length=500)  # a preset key or a custom directive
    locale: str = Field("zh-Hant", pattern="^(zh-Hant|en)$")


class OutlineIn(BaseModel):
    doc_id: str
    topic: str = Field(..., min_length=1, max_length=500)  # what the paper is about
    locale: str = Field("zh-Hant", pattern="^(zh-Hant|en)$")


class ExportIn(BaseModel):
    title: str = Field("", max_length=300)
    content_json: dict[str, Any]  # the live TipTap doc (sent directly to avoid DB staleness)
    style: str = Field("apa", pattern="^(apa|mla|chicago|harvard|ieee|numeric)$")
    locale: str = Field("zh-Hant", pattern="^(zh-Hant|en)$")
    format: str = Field("docx", pattern="^(docx|latex|md|txt|html)$")
    template: str = Field("article", pattern="^(article|twocolumn|ieee)$")  # LaTeX only


router = APIRouter()


def _resolve_upload_dir() -> Path:
    # Env-controlled for Docker / lab server. Order: UPLOAD_DIR > DATA_DIR/uploads
    # > backend/uploads (local-dev fallback).
    explicit = os.getenv("UPLOAD_DIR")
    if explicit:
        return Path(explicit)
    data_dir = os.getenv("DATA_DIR")
    if data_dir:
        return Path(data_dir) / "uploads"
    return Path(__file__).parent.parent / "uploads"


UPLOAD_DIR = _resolve_upload_dir()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _resolve_pdf_path(pdf_path: str | None) -> Path | None:
    """DB stores pdf_path as basename (e.g. 'paper_3ecdd642.pdf') going forward.
    Legacy rows may contain absolute paths — accept those too for backward compat."""
    if not pdf_path:
        return None
    p = Path(pdf_path)
    return p if p.is_absolute() else UPLOAD_DIR / p

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
    raw: bytes,
    filename: str,
) -> None:
    try:
        # Extraction moved here from the upload handler so the OCR fallback
        # (used when the PDF has no ToUnicode CMap) doesn't block the HTTP
        # request — OCR on a 30-page paper can take minutes.
        _set_job(job_id, status="extracting", message="Parsing PDF…")

        def _on_ocr_fallback() -> None:
            # Flipped once the native extractor returns glyph-cipher garbage
            # and the pipeline falls back to tesseract — gives the user a
            # reason for the long wait instead of an indefinite spinner.
            _set_job(
                job_id,
                message="PDF text layer unreadable — running OCR (about 3–5 min)…",
            )

        spans = pipeline.extract_spans_from_bytes(
            raw, filename, on_ocr_fallback=_on_ocr_fallback
        )
        if not spans:
            raise ValueError("empty document")

        # Title resolution: prefer what the user typed; otherwise have the LLM
        # read the real title off the paper's first page (cheap mini call),
        # falling back to the filename. Saves users from retyping / renaming.
        resolved_title = title.strip()
        if not resolved_title:
            _set_job(job_id, message="Detecting paper title…")
            resolved_title = (
                pipeline.detect_paper_title(spans, paper_id=paper_id) or filename
            )
            _set_job(job_id, title=resolved_title)
            db.update_paper_title(paper_id, resolved_title)

        _set_job(job_id, status="extracting", message="Building EDU/ER/RST/FRU…")
        graph = pipeline.build_paper_graph(
            spans, title=resolved_title, paper_id=paper_id
        )
        kg.write_graph(graph)

        _set_job(job_id, status="checking", message="Running 13 REL rules…")
        defects, rule_meta = rules.check_all_rules(paper_id, paper_title=resolved_title)

        # Cross-section second pass (REL-04/08/12). Opt-in via env; default ON.
        # Wrapped in its own try/except so a model-access error (e.g. the user
        # doesn't have 1M-context Opus) doesn't discard the per-section results
        # — those already cost real money. We just skip the cross-section layer
        # and surface a warning in the job message.
        if os.getenv("ENABLE_CROSS_SECTION_PASS", "1") == "1" and graph.edus:
            try:
                cs_defects, cs_meta = rules.cross_section_pass(
                    paper_id, resolved_title, graph.edus
                )
                defects.extend(cs_defects)
                rule_meta.append(cs_meta)
            except Exception as cs_exc:
                _set_job(
                    job_id,
                    cross_section_warning=f"cross-section pass skipped: {cs_exc!r}",
                )

        # Fill non-primary locales (e.g. en) on every defect's description/
        # suggestion via a batched translation pass — best-effort, never fatal.
        try:
            rules.localize_defects(defects, paper_id)
        except Exception as tr_exc:
            _set_job(job_id, translate_warning=f"translation pass skipped: {tr_exc!r}")

        result = AnalysisResult(
            paper_id=paper_id, graph=graph, defects=defects, rule_meta=rule_meta
        )
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
    pdf_filename = f"{paper_id.replace(':', '_')}{suffix}"
    saved_path = UPLOAD_DIR / pdf_filename
    saved_path.write_bytes(raw)
    # 把 user-input title 跟原始 filename 分開存：title 可為空（fallback 顯示
    # filename），但 filename 永遠記錄原檔名。
    # pdf_path 只存 basename（不存絕對路徑），讀取時用 _resolve_pdf_path() 拼回。
    # 這擋掉資料夾搬移 / Docker 掛載點不同造成的「檔案找不到」災難。
    db.upsert_paper(
        paper_id,
        title.strip(),
        file.filename,
        content_hash,
        pdf_filename,
    )

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
        title,  # raw user title (may be empty) — _run_analysis auto-detects if blank
        raw,
        file.filename,
    )
    return {"job_id": job_id, "paper_id": paper_id, "cached": False}


@router.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict[str, Any]:
    job = _get_job(job_id)
    if job is None:
        raise HTTPException(404, "unknown job")
    return job


@router.delete("/api/papers/{paper_id}")
def delete_paper(paper_id: str) -> dict[str, str]:
    """Remove a paper from SQLite + Neo4j + uploaded PDF on disk."""
    paper = db.get_paper(paper_id)
    if paper is None:
        raise HTTPException(404, "paper not found")
    pdf_path = paper.get("pdf_path")
    try:
        kg.clear_paper(paper_id)
    except Exception:
        pass  # Neo4j may already be empty for this paper
    db.delete_paper(paper_id)
    resolved = _resolve_pdf_path(pdf_path)
    if resolved:
        try:
            resolved.unlink(missing_ok=True)
        except Exception:
            pass
    return {"status": "deleted", "paper_id": paper_id}


@router.get("/api/papers/{paper_id}/pdf")
def paper_pdf(paper_id: str) -> FileResponse:
    paper = db.get_paper(paper_id)
    if paper is None or not paper.get("pdf_path"):
        raise HTTPException(404, "PDF not found for this paper")
    path = _resolve_pdf_path(paper["pdf_path"])
    if not path or not path.exists():
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
        # Display title: prefer user-input title, fallback to filename, then graph title.
        user_title = p.get("title")
        filename = p.get("filename") or ""
        display_title = (
            user_title or filename or result.get("graph", {}).get("title", "")
        )
        items.append({
            "paper_id": p["paper_id"],
            "title": display_title,
            "filename": filename,
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


@router.get("/api/rules/stats")
def rules_stats() -> dict[str, Any]:
    """Per-rule firing rate + judgment precision across all analyzed papers."""
    rule_defs = rules.load_rules()
    firing = db.rule_firing_stats()
    judgments = db.judgment_summary()
    j_by_rule = {j["rule_id"]: j for j in judgments["by_rule"]}

    items: list[dict[str, Any]] = []
    for r in rule_defs:
        rid = r["id"]
        fire = firing["per_rule"].get(rid, {"papers_fired": 0, "total_defects": 0})
        j = j_by_rule.get(
            rid,
            {"total": 0, "correct": 0, "wrong": 0, "partial": 0, "precision": None},
        )
        items.append(
            {
                "rule_id": rid,
                "name": r["name"],
                "defect_label": r.get("defect_label", ""),
                "papers_fired": fire["papers_fired"],
                "total_defects": fire["total_defects"],
                "judged_total": j["total"],
                "judged_correct": j["correct"],
                "judged_wrong": j["wrong"],
                "judged_partial": j["partial"],
                "precision": j["precision"],
            }
        )
    return {
        "papers_analyzed": firing["papers_analyzed"],
        "items": items,
    }


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


@router.get("/api/judgments/export")
def judgments_export() -> dict[str, Any]:
    """Full JSON dump of all judgments + defect details. Used as ground-truth export."""
    return db.export_judgments_with_defects()


@router.get("/api/eval/summary")
def eval_summary() -> dict[str, Any]:
    """LLM vs Human-as-judge accuracy: overall, per-rule, per-severity, per-confidence."""
    return db.evaluation_summary()


# ---------- paper-scoped chat assistant ----------

@router.post("/api/papers/{paper_id}/chat")
def paper_chat(paper_id: str, body: ChatIn) -> dict[str, Any]:
    paper = db.get_paper(paper_id)
    if paper is None:
        raise HTTPException(404, "paper not found")
    if db.get_result(paper_id) is None:
        raise HTTPException(409, "paper analysis not finished yet")

    try:
        return chat_mod.chat(
            paper_id=paper_id,
            paper_title=paper.get("title") or "",
            messages=[m.model_dump() for m in body.messages],
            lang=body.lang,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except RuntimeError as e:
        msg = str(e)
        if msg.startswith("rate_limited:"):
            wait = msg.split(":", 1)[1]
            raise HTTPException(
                429,
                f"chat rate limit reached, retry in ~{wait}s",
            ) from e
        raise HTTPException(500, msg) from e


# ---------- editor mode: writing documents ----------
# Independent of the paper-analysis flow above. These power the new WYSIWYG
# writing editor (/[locale]/editor): create a doc, autosave its ProseMirror
# JSON, and keep version snapshots. No account system yet — docs are global.

@router.post("/api/editor/documents")
def create_document(body: DocumentCreateIn) -> dict[str, Any]:
    doc_id = f"doc:{uuid.uuid4().hex[:8]}"
    title = body.title.strip() or "未命名文件"
    content = body.content_json if body.content_json is not None else EMPTY_DOC
    return db.create_document(doc_id, title, content, body.locale)


@router.get("/api/editor/documents")
def list_documents() -> list[dict[str, Any]]:
    return db.list_documents()


@router.get("/api/editor/documents/{doc_id}")
def get_document(doc_id: str) -> dict[str, Any]:
    doc = db.get_document(doc_id)
    if doc is None:
        raise HTTPException(404, "document not found")
    return doc


@router.put("/api/editor/documents/{doc_id}")
def update_document(doc_id: str, body: DocumentUpdateIn) -> dict[str, Any]:
    """Autosave / rename. Sends only the changed fields (see DocumentUpdateIn)."""
    if body.title is None and body.content_json is None:
        raise HTTPException(400, "nothing to update")
    ok = db.update_document(
        doc_id,
        title=body.title.strip() if body.title is not None else None,
        content_json=body.content_json,
    )
    if not ok:
        raise HTTPException(404, "document not found")
    return {"status": "ok", "doc_id": doc_id}


@router.delete("/api/editor/documents/{doc_id}")
def delete_document(doc_id: str) -> dict[str, str]:
    if db.get_document(doc_id) is None:
        raise HTTPException(404, "document not found")
    db.delete_document(doc_id)
    return {"status": "deleted", "doc_id": doc_id}


@router.post("/api/editor/documents/{doc_id}/versions")
def create_document_version(doc_id: str, body: VersionCreateIn) -> dict[str, Any]:
    """Save a version snapshot (autosave-pruned, or a permanent named version)."""
    if db.get_document(doc_id) is None:
        raise HTTPException(404, "document not found")
    version_id = db.snapshot_document(doc_id, body.content_json, label=body.label)
    return {"status": "ok", "version_id": version_id}


@router.get("/api/editor/documents/{doc_id}/versions")
def list_document_versions(doc_id: str) -> list[dict[str, Any]]:
    if db.get_document(doc_id) is None:
        raise HTTPException(404, "document not found")
    return db.list_document_versions(doc_id)


@router.get("/api/editor/documents/{doc_id}/versions/{version_id}")
def get_document_version(doc_id: str, version_id: int) -> dict[str, Any]:
    version = db.get_document_version(doc_id, version_id)
    if version is None:
        raise HTTPException(404, "version not found")
    return version


@router.post("/api/editor/autocomplete")
def autocomplete(body: AutocompleteIn) -> StreamingResponse:
    """Stream an inline writing suggestion as Server-Sent Events.

    Rate-limited per document up front (a 429 before any bytes stream), then the
    body streams `data: {"t": "<delta>"}` chunks ending with `data: [DONE]`.
    """
    allowed, wait = autocomplete_mod.check_rate_limit(body.doc_id)
    if not allowed:
        raise HTTPException(429, f"autocomplete rate limit reached, retry in ~{wait}s")
    return StreamingResponse(
        autocomplete_mod.sse_stream(
            doc_id=body.doc_id,
            text_before=body.text_before,
            title=body.title,
            outline=body.outline,
            locale=body.locale,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Disable proxy buffering (Caddy/nginx) so tokens flush immediately.
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/api/editor/citations/recommend")
def recommend_citations(body: CitationRecommendIn) -> dict[str, Any]:
    """Find citation candidates (OpenAlex) for a selected claim sentence.

    Rate-limited per document up front (429). Returns OpenAlex's own relevance
    ordering — no embedding rerank in this slice. Candidate metadata is returned
    to the client and persisted in the editor's citation marks, not stored here.
    """
    allowed, wait = citation_mod.check_rate_limit(body.doc_id)
    if not allowed:
        raise HTTPException(429, f"citation search rate limit reached, retry in ~{wait}s")
    claim = body.claim.strip()
    if not claim:
        return {"candidates": []}
    try:
        candidates = citation_mod.recommend(claim, year_from=body.year_from)
    except citation_mod.CitationSearchError as exc:
        raise HTTPException(502, f"OpenAlex unavailable: {exc}") from exc
    return {"candidates": candidates}


@router.post("/api/editor/citations/relink")
def relink_citations(body: CitationRelinkIn) -> dict[str, Any]:
    """Rebuild plain-text references in an imported doc into live citations.

    Heavy (LLM parse + OpenAlex + embeddings) → rate-limited per doc (429).
    High-confidence only: each reference is matched on OpenAlex and accepted just
    when the title is a strong semantic match, then in-text (Author, year) markers
    are replaced with citation nodes. Returns {content_json, stats}. The reference
    panel regenerates from the new nodes, so matches show up there with links.
    """
    allowed, wait = citation_relink_mod.check_rate_limit(body.doc_id)
    if not allowed:
        raise HTTPException(429, f"relink rate limit reached, retry in ~{wait}s")
    try:
        return citation_relink_mod.relink(body.content_json, body.doc_id)
    except Exception as exc:  # noqa: BLE001 — LLM/OpenAlex failure → 502
        raise HTTPException(502, f"citation relink failed: {exc}") from exc


@router.post("/api/editor/citations/refresh")
def refresh_citations(body: CitationRefreshIn) -> dict[str, Any]:
    """Re-fetch the document's citations by OpenAlex id to refresh stale metadata
    (chiefly rotted links). Returns {openalex_id: fresh candidate}; ids OpenAlex
    no longer knows are simply absent, so the client leaves those citations as-is.
    """
    ids = [i for i in body.openalex_ids if i.strip()]
    if not ids:
        return {"citations": {}}
    try:
        citations = citation_mod.refresh(ids)
    except citation_mod.CitationSearchError as exc:
        raise HTTPException(502, f"OpenAlex unavailable: {exc}") from exc
    return {"citations": citations}


@router.post("/api/editor/citations/verify")
def verify_citation(body: CitationVerifyIn) -> dict[str, Any]:
    """Claim–evidence check: does this source actually support the claim?

    Returns {verdict: supports|partial|unsupported|unknown, evidence, reason,
    confidence}. The abstract is sent from the client (already on the candidate),
    so no OpenAlex round-trip. Rate-limited per document.
    """
    allowed, wait = claim_verifier_mod.check_rate_limit(body.doc_id)
    if not allowed:
        raise HTTPException(429, f"verify rate limit reached, retry in ~{wait}s")
    try:
        return claim_verifier_mod.verify(
            body.claim, body.title, body.abstract, body.doc_id, body.locale,
            openalex_id=body.openalex_id,
        )
    except Exception as exc:  # noqa: BLE001 — LLM/quota failure → 502
        raise HTTPException(502, f"verification failed: {exc}") from exc


@router.post("/api/editor/citations/ground")
def ground_citation(body: CitationGroundIn) -> dict[str, Any]:
    """Full-text grounding: top sentences in the cited source matching the claim.

    Returns {source: fulltext|abstract|none, supporting: [{sentence, score}]}.
    Heavy on first hit (fetch + embed); cached per paper. Rate-limited per doc.
    """
    allowed, wait = grounding_mod.check_rate_limit(body.doc_id)
    if not allowed:
        raise HTTPException(429, f"grounding rate limit reached, retry in ~{wait}s")
    try:
        return grounding_mod.ground(body.openalex_id, body.oa_url, body.claim, body.doc_id)
    except grounding_mod.GroundingError as exc:
        raise HTTPException(502, f"grounding failed: {exc}") from exc


@router.post("/api/editor/check")
def check_draft(body: DraftCheckIn) -> dict[str, Any]:
    """Run the Thesis Critic's single-section REL rules on the draft text.

    Heavy (several LLM calls) → rate-limited per document (429). Returns
    {defects: [{rule_id, defect_type, severity, section, description,
    suggestion, confidence, evidence}]} for the editor to render inline.
    """
    allowed, wait = draft_check_mod.check_rate_limit(body.doc_id)
    if not allowed:
        raise HTTPException(429, f"defect check rate limit reached, retry in ~{wait}s")
    try:
        defects = draft_check_mod.check_draft(body.text, body.doc_id, body.locale)
    except Exception as exc:  # noqa: BLE001 — pipeline/LLM failure → 502
        raise HTTPException(502, f"defect check failed: {exc}") from exc
    return {"defects": defects}


@router.post("/api/editor/rewrite")
def rewrite(body: RewriteIn) -> StreamingResponse:
    """Stream an AI rewrite of the selected passage as Server-Sent Events.

    Rate-limited per document up front (429 before any bytes), then the body
    streams `data: {"t": "<delta>"}` chunks ending with `data: [DONE]`. The
    instruction is either a preset key (paraphrase, simplify, …) or a custom
    directive typed by the author.
    """
    allowed, wait = rewrite_mod.check_rate_limit(body.doc_id)
    if not allowed:
        raise HTTPException(429, f"rewrite rate limit reached, retry in ~{wait}s")
    return StreamingResponse(
        rewrite_mod.sse_stream(
            doc_id=body.doc_id,
            text=body.text,
            instruction=body.instruction,
            locale=body.locale,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/api/editor/outline")
def generate_outline(body: OutlineIn) -> dict[str, Any]:
    """Generate a thesis outline (heading tree) from a topic.

    Rate-limited per document (429). Returns {headings: [{level, text}]} for the
    client to insert as heading nodes. The fixed IMRaD template is built
    client-side, so this endpoint only serves the AI "Smart Headings" path.
    """
    allowed, wait = outline_mod.check_rate_limit(body.doc_id)
    if not allowed:
        raise HTTPException(429, f"outline rate limit reached, retry in ~{wait}s")
    try:
        headings = outline_mod.generate(body.topic, body.doc_id, body.locale)
    except Exception as exc:  # noqa: BLE001 — LLM/quota failure → 502
        raise HTTPException(502, f"outline generation failed: {exc}") from exc
    return {"headings": headings}


@router.post("/api/editor/export")
def export_document(body: ExportIn) -> Response:
    """Render the live document to .docx or .tex and return it as a download.

    The content is POSTed directly (not read from the DB) so an export always
    reflects the latest edits, even within the autosave debounce. In-text
    citations and the reference list use the requested style.
    """
    document = {"title": body.title, "content_json": body.content_json}
    refs_label = "參考文獻" if body.locale == "zh-Hant" else "References"
    if body.format == "docx":
        data = export_doc.to_docx(document, body.style, refs_label)
        media = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ext = "docx"
    elif body.format == "latex":
        tex, images = export_doc.to_latex(document, body.style, refs_label, body.template)
        if images:
            # Bundle .tex + referenced images so the export compiles as-is.
            import io
            import zipfile

            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                zf.writestr("main.tex", tex)
                for fname, fdata in images:
                    zf.writestr(fname, fdata)
            data = buf.getvalue()
            media = "application/zip"
            ext = "zip"
        else:
            data = tex.encode("utf-8")
            media = "application/x-tex"
            ext = "tex"
    elif body.format == "md":
        data = export_doc.to_markdown(document, body.style, refs_label).encode("utf-8")
        media = "text/markdown; charset=utf-8"
        ext = "md"
    elif body.format == "txt":
        data = export_doc.to_text(document, body.style, refs_label).encode("utf-8")
        media = "text/plain; charset=utf-8"
        ext = "txt"
    else:  # html (for online preview / browser print-to-PDF)
        data = export_doc.to_html(document, body.style, refs_label).encode("utf-8")
        media = "text/html; charset=utf-8"
        ext = "html"
    # RFC 5987 filename* carries the (possibly CJK) title; ascii filename is a fallback.
    name = quote((body.title or "document").strip() or "document")
    headers = {
        "Content-Disposition": f"attachment; filename=\"document.{ext}\"; filename*=UTF-8''{name}.{ext}"
    }
    return Response(content=data, media_type=media, headers=headers)


_IMPORT_EXTS = {"txt", "text", "md", "markdown", "mdown", "docx", "tex", "latex"}
_MAX_IMPORT_BYTES = 20 * 1024 * 1024  # 20 MB


@router.post("/api/editor/import")
async def import_document(file: UploadFile) -> dict[str, Any]:
    """Parse an uploaded .txt / .md / .docx / .tex into editor (ProseMirror) JSON.

    Returns {title, content_json}; the client creates a new document from it and
    opens the editor. Embedded DOCX images are saved to UPLOAD_DIR and referenced
    by figure nodes' src, so they render and re-export like any uploaded image.
    """
    if not file.filename:
        raise HTTPException(400, "missing filename")
    ext = Path(file.filename).suffix.lower().lstrip(".")
    if ext not in _IMPORT_EXTS:
        raise HTTPException(415, f"unsupported import type: .{ext or '?'}")
    raw = await file.read()
    if len(raw) > _MAX_IMPORT_BYTES:
        raise HTTPException(413, "file too large (max 20MB)")
    try:
        title, content_json = import_doc.to_prosemirror(file.filename, raw)
    except ValueError as exc:
        raise HTTPException(415, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — malformed upload → 422
        raise HTTPException(422, f"could not parse .{ext}: {exc}") from exc
    return {"title": title, "content_json": content_json}


_EDITOR_IMAGE_EXTS = {"png", "jpg", "jpeg", "gif", "webp"}
_MAX_EDITOR_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("/api/editor/upload")
async def upload_editor_image(file: UploadFile) -> dict[str, str]:
    """Store an uploaded image for the editor; return its serve path.

    Reuses UPLOAD_DIR (same volume as paper PDFs). The path is stored verbatim in
    the figure node, so the frontend prepends its API base when rendering.
    """
    if not file.filename:
        raise HTTPException(400, "missing filename")
    ext = Path(file.filename).suffix.lower().lstrip(".")
    if ext not in _EDITOR_IMAGE_EXTS:
        raise HTTPException(415, f"unsupported image type: .{ext or '?'}")
    raw = await file.read()
    if len(raw) > _MAX_EDITOR_IMAGE_BYTES:
        raise HTTPException(413, "image too large (max 10MB)")
    name = f"img_{uuid.uuid4().hex[:12]}.{ext}"
    (UPLOAD_DIR / name).write_bytes(raw)
    return {"url": f"/api/editor/images/{name}"}


@router.get("/api/editor/images/{name}")
def serve_editor_image(name: str) -> FileResponse:
    """Serve an uploaded editor image. Basename guard blocks path traversal."""
    if name != Path(name).name or not name:
        raise HTTPException(400, "invalid name")
    path = UPLOAD_DIR / name
    if not path.is_file():
        raise HTTPException(404, "not found")
    return FileResponse(path)
