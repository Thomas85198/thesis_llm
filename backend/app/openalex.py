"""OpenAlex client for Smart Citation: keyword-search academic works.

OpenAlex (https://openalex.org) is a free, key-less scholarly index. We send the
author's selected claim sentence as the search query and return the top
candidates, normalized to a flat shape the editor renders. No embedding /
re-ranking here — we trust OpenAlex's own `relevance_score` ordering (the MVP
ranking decision); semantic rerank is a later phase.
"""
from __future__ import annotations

import os
from typing import Any

import httpx

# Polite pool: OpenAlex asks for a contact email (in the `mailto` param + UA) so
# they can reach you about heavy usage; in return requests get faster, more
# stable routing. Override via env on the lab server.
_MAILTO = os.getenv("OPENALEX_MAILTO", "thesis-llm-demo@example.com")
_BASE_URL = "https://api.openalex.org/works"
_TIMEOUT = 10.0
# Only pull the fields we render — smaller, faster responses.
_SELECT = (
    "id,title,display_name,publication_year,doi,authorships,"
    "primary_location,open_access,cited_by_count,type,"
    "abstract_inverted_index,relevance_score"
)


def restore_abstract(inverted: dict[str, list[int]] | None) -> str:
    """Rebuild abstract text from OpenAlex's inverted index.

    OpenAlex ships abstracts as `{word: [positions]}` (a copyright workaround).
    Place each word at its position(s) and join. Returns "" when the work has no
    abstract (many don't — the caller falls back to title-only display).
    """
    if not inverted:
        return ""
    positions: list[tuple[int, str]] = []
    for word, idxs in inverted.items():
        for i in idxs:
            positions.append((i, word))
    positions.sort(key=lambda p: p[0])
    return " ".join(word for _, word in positions)


def best_url(work: dict[str, Any], location: dict[str, Any]) -> str:
    """A link that actually resolves to something readable.

    Many works lack a DOI, or the DOI landing page is a paywalled stub. Prefer
    the open-access full text, then DOI, then the publisher landing page, and
    finally the OpenAlex record itself (which always exists). This kills the
    "source link goes nowhere" problem.
    """
    oa = work.get("open_access") or {}
    return (
        oa.get("oa_url")
        or work.get("doi")
        or location.get("landing_page_url")
        or work.get("id")
        or ""
    )


def normalize(work: dict[str, Any]) -> dict[str, Any]:
    """Flatten one OpenAlex Work into the editor's candidate shape."""
    oa_id = (work.get("id") or "").rsplit("/", 1)[-1]  # ".../W2741809807" → "W2741809807"
    authors = [
        a["author"].get("display_name", "")
        for a in (work.get("authorships") or [])
        if a.get("author")
    ]
    authors = [a for a in authors if a]
    location = work.get("primary_location") or {}
    source = location.get("source") or {}
    return {
        "openalex_id": oa_id,
        "title": work.get("title") or work.get("display_name") or "(untitled)",
        "authors": authors,
        "year": work.get("publication_year"),
        "venue": source.get("display_name") or "",
        "doi": work.get("doi") or "",  # "https://doi.org/10.xxxx/..."
        "oa_url": (work.get("open_access") or {}).get("oa_url") or "",  # OA full text, may rot
        "url": best_url(work, location),  # always-resolvable source link
        "cited_by_count": work.get("cited_by_count") or 0,
        "type": work.get("type") or "",
        "abstract": restore_abstract(work.get("abstract_inverted_index")),
        "relevance_score": work.get("relevance_score"),
    }


def search_works(
    query: str, per_page: int = 15, year_from: int | None = None
) -> list[dict[str, Any]]:
    """Search OpenAlex works by free-text `query`; return normalized candidates
    in OpenAlex's own relevance order.

    Quality filter: `has_abstract:true` drops paratext / records with no
    abstract (usually noise and unjudgeable). `year_from` keeps only works
    published on/after that year. Raises httpx.HTTPError on network/HTTP
    failure; an empty/whitespace query returns [] without a call.
    """
    query = (query or "").strip()
    if not query:
        return []
    filters = ["has_abstract:true"]
    if year_from:
        filters.append(f"from_publication_date:{year_from}-01-01")
    params = {
        "search": query[:500],  # search is keyword-y; cap pathological input
        "per-page": max(1, min(per_page, 25)),
        "mailto": _MAILTO,
        "select": _SELECT,
        "filter": ",".join(filters),
    }
    headers = {"User-Agent": f"thesis-llm-demo/1.0 (mailto:{_MAILTO})"}
    with httpx.Client(timeout=_TIMEOUT, headers=headers) as cli:
        resp = cli.get(_BASE_URL, params=params)
        resp.raise_for_status()
        data = resp.json()
    return [normalize(w) for w in (data.get("results") or [])]
