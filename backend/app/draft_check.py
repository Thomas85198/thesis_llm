"""Defect-check-on-draft: run the Thesis Critic's REL rules on editor text.

Reuses the analysis pipeline (spans → EDU/ER/RST/FRU graph → Neo4j → REL rule
checks) on a *draft* the author is writing, instead of an uploaded PDF. The
graph is written under a throwaway paper_id and cleared afterwards; defects'
evidence EDU ids are resolved back to their text so the editor can locate them.

Only single-section rules run — the cross-section rules (REL-04/08/12) need
whole-paper context and are meaningless on a working draft. This is heavy
(several LLM calls), so it is triggered on demand, not on every keystroke.
"""

from __future__ import annotations

import hashlib
import threading
import time
import uuid
from typing import Any

from . import db, i18n, kg, pipeline, rules
from .schemas import AnalysisResult

# Rules meaningful on a draft fragment (exclude whole-paper REL-04/08/12).
SINGLE_SECTION_RULES = {
    "REL-01",
    "REL-02",
    "REL-03",
    "REL-05",
    "REL-06",
    "REL-07",
    "REL-09",
    "REL-10",
    "REL-11",
    "REL-13",
}
MAX_DRAFT_CHARS = 20000

# Bump to invalidate every cached section result (e.g. when rules/prompts change).
RULES_VERSION = "1"


def _section_key(text: str, loc: str) -> str:
    return hashlib.sha256(f"{text}|{loc}|{RULES_VERSION}".encode("utf-8")).hexdigest()


# Defect check fans out into many LLM calls; cap hard per document.
RATE_LIMIT_PER_MIN = 6  # per doc_id

_rate_lock = threading.Lock()
_rate_buckets: dict[str, list[float]] = {}


def check_rate_limit(doc_id: str) -> tuple[bool, int]:
    """Return (allowed, seconds_until_next_slot). Sliding 60s window per doc."""
    now = time.time()
    window = 60.0
    with _rate_lock:
        bucket = [t for t in _rate_buckets.get(doc_id, []) if now - t < window]
        if len(bucket) >= RATE_LIMIT_PER_MIN:
            wait = max(1, int(window - (now - min(bucket))))
            _rate_buckets[doc_id] = bucket
            return False, wait
        bucket.append(now)
        _rate_buckets[doc_id] = bucket
    return True, 0


def _format_defect(d, loc: str, edu_text: dict[str, str]) -> dict[str, Any]:
    return {
        "rule_id": d.rule_id,
        "defect_type": d.defect_type,
        "severity": d.severity.value
        if hasattr(d.severity, "value")
        else str(d.severity),
        "section": str(d.section),
        "description": i18n.pick(d.description, loc),
        "suggestion": i18n.pick(d.suggestion, loc),
        "confidence": d.confidence,
        "evidence": [edu_text[i] for i in d.evidence_edu_ids if i in edu_text],
    }


def _check_one_section(text: str, loc: str) -> list[dict[str, Any]]:
    """Build a graph for one section's text + run single-section rules. Heavy
    (several LLM calls). The temporary graph is always cleared, even on error."""
    paper_id = f"draft:{uuid.uuid4().hex[:8]}"
    try:
        spans = pipeline.extract_spans_from_bytes(
            text[:MAX_DRAFT_CHARS].encode("utf-8"), "draft.txt"
        )
        graph = pipeline.build_paper_graph(spans, title="", paper_id=paper_id)
        kg.write_graph(graph)
        edu_text = {e.id: e.text for e in graph.edus}
        defects, _meta = rules.check_all_rules(paper_id)
        return [
            _format_defect(d, loc, edu_text)
            for d in defects
            if d.rule_id in SINGLE_SECTION_RULES
        ]
    finally:
        try:
            kg.clear_paper(paper_id)
        except Exception:  # noqa: BLE001 — best-effort cleanup
            pass


def draft_paper_id(doc_id: str) -> str:
    """Stable Neo4j paper_id for a document's draft graph: one graph per doc,
    overwritten on each full check (so the graph never accumulates) and kept
    around afterwards so the editor can visualize it."""
    return f"draft:{hashlib.sha256(doc_id.encode('utf-8')).hexdigest()[:12]}"


# Whole-draft check caps at more than one section's worth so cross-section rules
# have multiple sections to compare.
MAX_FULL_CHARS = 40000


def check_draft_full(
    sections: list[str], doc_id: str, locale: str | None
) -> dict[str, Any]:
    """Whole-draft check: build ONE combined graph and run single-section +
    cross-section rules (REL-04/08/12). Heavier than the cached per-section path
    — used on demand for the deep / knowledge-graph check. Cross-section is
    best-effort (skipped if the model is unavailable).

    Returns both the editor-shaped defect dicts (for the defect panel) and the
    full AnalysisResult (for the KGFlow knowledge-graph view), so the editor
    renders the SAME rich graph UI as the paper-analysis page."""
    loc = i18n.normalize_locale(locale)
    text = "\n\n".join(s.strip() for s in sections if (s or "").strip())
    if not text:
        return {"defects": [], "result": None}
    paper_id = draft_paper_id(doc_id)
    kg.clear_paper(paper_id)  # replace the previous draft graph
    spans = pipeline.extract_spans_from_bytes(
        text[:MAX_FULL_CHARS].encode("utf-8"), "draft.txt"
    )
    graph = pipeline.build_paper_graph(spans, title="", paper_id=paper_id)
    kg.write_graph(graph)  # kept (not cleared) for the KG viz
    edu_text = {e.id: e.text for e in graph.edus}
    defects, rule_meta = rules.check_all_rules(paper_id)
    if graph.edus:
        try:
            cs_defects, cs_meta = rules.cross_section_pass(paper_id, "", graph.edus)
            defects.extend(cs_defects)
            rule_meta.append(cs_meta)
        except Exception:  # noqa: BLE001 — model unavailable → skip cross-section
            pass
    result = AnalysisResult(
        paper_id=paper_id, graph=graph, defects=defects, rule_meta=rule_meta
    )
    return {
        "defects": [_format_defect(d, loc, edu_text) for d in defects],
        "result": result.model_dump(),
    }


def check_draft_sections(
    sections: list[str], doc_id: str, locale: str | None
) -> list[dict[str, Any]]:
    """Incremental defect check: each section's defects are cached by its content
    hash, so re-checking only re-runs the sections whose text changed (cache hits
    cost 0 LLM). Merges and returns all sections' defect dicts."""
    loc = i18n.normalize_locale(locale)
    out: list[dict[str, Any]] = []
    for raw in sections:
        text = (raw or "").strip()
        if not text:
            continue
        key = _section_key(text, loc)
        cached = db.get_draft_cache(key)
        if cached is not None:
            out.extend(cached)
            continue
        defects = _check_one_section(text, loc)
        db.set_draft_cache(key, defects)
        out.extend(defects)
    return out


def check_draft(text: str, doc_id: str, locale: str | None) -> list[dict[str, Any]]:
    """Single-section convenience wrapper (back-compat) over the section API."""
    text = (text or "").strip()
    if not text:
        return []
    return check_draft_sections([text], doc_id, locale)
