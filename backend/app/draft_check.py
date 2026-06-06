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

import threading
import time
import uuid
from typing import Any

from . import i18n, kg, pipeline, rules

# Rules meaningful on a draft fragment (exclude whole-paper REL-04/08/12).
SINGLE_SECTION_RULES = {
    "REL-01", "REL-02", "REL-03", "REL-05", "REL-06",
    "REL-07", "REL-09", "REL-10", "REL-11", "REL-13",
}
MAX_DRAFT_CHARS = 20000

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


def check_draft(text: str, doc_id: str, locale: str | None) -> list[dict[str, Any]]:
    """Run single-section REL rules on `text`; return a list of defect dicts.

    Each defect: {rule_id, defect_type, severity, section, description,
    suggestion, confidence, evidence: [edu_text, …]}. The temporary graph is
    always cleared, even on error.
    """
    text = (text or "").strip()
    if not text:
        return []
    loc = i18n.normalize_locale(locale)
    paper_id = f"draft:{uuid.uuid4().hex[:8]}"
    try:
        spans = pipeline.extract_spans_from_bytes(
            text[:MAX_DRAFT_CHARS].encode("utf-8"), "draft.txt"
        )
        graph = pipeline.build_paper_graph(spans, title="", paper_id=paper_id)
        kg.write_graph(graph)
        edu_text = {e.id: e.text for e in graph.edus}

        defects, _meta = rules.check_all_rules(paper_id)
        out: list[dict[str, Any]] = []
        for d in defects:
            if d.rule_id not in SINGLE_SECTION_RULES:
                continue
            evidence = [edu_text[i] for i in d.evidence_edu_ids if i in edu_text]
            out.append(
                {
                    "rule_id": d.rule_id,
                    "defect_type": d.defect_type,
                    "severity": d.severity.value if hasattr(d.severity, "value") else str(d.severity),
                    "section": str(d.section),
                    "description": i18n.pick(d.description, loc),
                    "suggestion": i18n.pick(d.suggestion, loc),
                    "confidence": d.confidence,
                    "evidence": evidence,
                }
            )
        return out
    finally:
        try:
            kg.clear_paper(paper_id)
        except Exception:  # noqa: BLE001 — best-effort cleanup
            pass
