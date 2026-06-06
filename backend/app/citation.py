"""Smart Citation recommend: a claim sentence → OpenAlex candidates.

Thin layer mirroring autocomplete.py: an in-memory per-document rate limit in
front of a single OpenAlex call. No LLM, no DB in this slice — candidate
metadata rides home in the editor's citation marks (persisted with the doc's
content_json), so there's nothing to store server-side.
"""
from __future__ import annotations

import math
import re
import threading
import time

import httpx

from . import llm, openalex
from .prompts import load_prompt

_CJK = re.compile(r"[一-鿿]")  # any CJK ideograph → claim is Chinese

_QUERY_SCHEMA = {
    "type": "object",
    "properties": {"query": {"type": "string"}},
    "required": ["query"],
    "additionalProperties": False,
}


class CitationSearchError(RuntimeError):
    """OpenAlex was unreachable / returned an error. Routes map this to a 502."""


def to_search_query(claim: str) -> str:
    """Turn a claim into an English keyword query for OpenAlex.

    OpenAlex is English-centric, so a Chinese claim searched verbatim recalls
    almost nothing. When the claim contains CJK, ask the light model to extract
    English keywords. Any failure (no quota, network) degrades gracefully back
    to the raw claim rather than blocking the search.
    """
    claim = claim.strip()
    if not _CJK.search(claim):
        return claim
    try:
        result = llm.call_with_tool(
            model=llm.model_light(),
            system=load_prompt("citation_query"),
            user_content=claim,
            tool_name="search_query",
            tool_description="Provide an English keyword query for an academic database.",
            tool_input_schema=_QUERY_SCHEMA,
            max_tokens=100,
            stage="citation_query",
        )
        return (result.get("query") or "").strip() or claim
    except Exception:  # noqa: BLE001 — no quota / API blip: fall back to raw claim
        return claim


# Citation search is user-initiated (a click), far rarer than autocomplete, but
# we still cap it per-document as a backstop against a stuck/abusive client.
RATE_LIMIT_PER_MIN = 30  # per doc_id

_rate_lock = threading.Lock()
_rate_buckets: dict[str, list[float]] = {}


def check_rate_limit(doc_id: str) -> tuple[bool, int]:
    """Return (allowed, seconds_until_next_slot). Sliding 60s window per doc.

    Same shape as autocomplete.check_rate_limit — kept separate so the two
    features have independent buckets and ceilings.
    """
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


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na and nb else 0.0


def rerank_by_claim(claim: str, candidates: list[dict]) -> list[dict]:
    """Re-order candidates by semantic similarity of claim ↔ abstract.

    OpenAlex's keyword relevance often mis-ranks for nuanced claims; embedding
    the claim against each abstract surfaces the ones that actually match the
    meaning. Graceful: <2 abstracts, or any embedding failure → original order.
    Candidates without an abstract keep their order and sink to the end.
    """
    with_abs = [c for c in candidates if (c.get("abstract") or "").strip()]
    without_abs = [c for c in candidates if not (c.get("abstract") or "").strip()]
    if len(with_abs) < 2:
        return candidates
    try:
        vecs = llm.embed([claim] + [c["abstract"] for c in with_abs])
    except Exception:  # noqa: BLE001 — no quota / API blip: keep keyword order
        return candidates
    claim_vec, abs_vecs = vecs[0], vecs[1:]
    # Attach the similarity so the UI can show it ("semantic 87%").
    scored = [(c, _cosine(claim_vec, v)) for c, v in zip(with_abs, abs_vecs)]
    for c, s in scored:
        c["similarity"] = round(s, 4)
    scored.sort(key=lambda p: p[1], reverse=True)
    return [c for c, _ in scored] + without_abs


def recommend(
    claim: str, per_page: int = 15, year_from: int | None = None, rerank: bool = True
) -> list[dict]:
    """Return OpenAlex candidates for a claim.

    The claim is first turned into an English keyword query (no-op for English
    input), then searched with the quality + year filters applied upstream.
    When `rerank` (default), the results are semantically re-ordered by how well
    each abstract matches the original claim (beats raw keyword relevance).
    """
    query = to_search_query(claim)
    try:
        candidates = openalex.search_works(query, per_page=per_page, year_from=year_from)
    except httpx.HTTPError as exc:
        raise CitationSearchError(str(exc)) from exc
    if rerank and claim.strip():
        candidates = rerank_by_claim(claim.strip(), candidates)
    return candidates


def refresh(openalex_ids: list[str]) -> dict[str, dict]:
    """Re-fetch citations by OpenAlex id → {id: fresh candidate}.

    Powers the "refresh links" action: a citation's metadata is frozen into the
    editor node at insert time, so links that have since rotted (or that predate
    the trusted-source selection) only update when re-pulled from OpenAlex here.
    """
    try:
        return openalex.get_works_by_ids(openalex_ids)
    except httpx.HTTPError as exc:
        raise CitationSearchError(str(exc)) from exc
