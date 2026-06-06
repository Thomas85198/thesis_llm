"""Smart Citation recommend: a claim sentence → OpenAlex candidates.

Thin layer mirroring autocomplete.py: an in-memory per-document rate limit in
front of a single OpenAlex call. No LLM, no DB in this slice — candidate
metadata rides home in the editor's citation marks (persisted with the doc's
content_json), so there's nothing to store server-side.
"""
from __future__ import annotations

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


def recommend(
    claim: str, per_page: int = 15, year_from: int | None = None
) -> list[dict]:
    """Return OpenAlex candidates for a claim, in relevance order.

    The claim is first turned into an English keyword query (no-op for English
    input), then searched with the quality + year filters applied upstream.
    """
    query = to_search_query(claim)
    try:
        return openalex.search_works(query, per_page=per_page, year_from=year_from)
    except httpx.HTTPError as exc:
        raise CitationSearchError(str(exc)) from exc
