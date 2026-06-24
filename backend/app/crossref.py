"""Crossref client: resolve a DOI (or a DOI embedded in a URL) to citation
metadata. Crossref is free with no per-day credit cap (unlike OpenAlex's
usage-based pricing), so it backs the manual "paste a DOI" fallback for
unlinked citations — and a search fallback when OpenAlex is rate-limited.
"""

from __future__ import annotations

import os
from typing import Any
import re

import httpx

# Crossref's polite pool: a contact email in the UA + mailto param (optional but
# gives more reliable routing). Reuse the same env knob as OpenAlex.
_MAILTO = os.getenv("OPENALEX_MAILTO", "thesis-llm-demo@example.com")
_WORKS = "https://api.crossref.org/works/"
_SEARCH = "https://api.crossref.org/works"
_TIMEOUT = 12.0
_DOI_RE = re.compile(r"10\.\d{4,9}/[-._;()/:a-z0-9]+", re.I)
# Crossref abstracts ship as JATS XML (<jats:p>…</jats:p>); strip tags to text.
_TAG_RE = re.compile(r"<[^>]+>")
# Only the fields we render — smaller, faster responses.
_SELECT = (
    "DOI,title,author,container-title,published,published-print,"
    "published-online,URL,is-referenced-by-count,type,abstract"
)


def _strip_abstract(raw: str) -> str:
    if not raw:
        return ""
    return re.sub(r"\s+", " ", _TAG_RE.sub(" ", raw)).strip()


def extract_doi(text: str) -> str:
    """Pull a bare DOI out of a string/URL ("https://doi.org/10.x/y" → "10.x/y")."""
    m = _DOI_RE.search(text or "")
    return m.group(0).rstrip(".,);") if m else ""


def _normalize(msg: dict[str, Any]) -> dict[str, Any]:
    """One Crossref work → the editor's candidate shape (matches openalex.normalize)."""
    authors = [
        " ".join(p for p in (a.get("given", ""), a.get("family", "")) if p).strip()
        for a in (msg.get("author") or [])
    ]
    authors = [a for a in authors if a]
    date = (
        msg.get("published")
        or msg.get("published-print")
        or msg.get("published-online")
        or {}
    )
    parts = date.get("date-parts") or [[None]]
    year = parts[0][0] if parts and parts[0] else None
    doi = (msg.get("DOI") or "").lower()
    return {
        "openalex_id": "",
        "title": (msg.get("title") or [""])[0] or "(untitled)",
        "authors": authors,
        "year": year,
        "venue": (msg.get("container-title") or [""])[0] or "",
        "doi": f"https://doi.org/{doi}" if doi else "",
        "oa_url": "",
        "url": msg.get("URL") or (f"https://doi.org/{doi}" if doi else ""),
        "cited_by_count": msg.get("is-referenced-by-count") or 0,
        "type": msg.get("type") or "",
        "abstract": _strip_abstract(msg.get("abstract", "")),
        "relevance_score": None,
    }


def search_works(
    query: str, rows: int = 15, year_from: int | None = None
) -> list[dict[str, Any]]:
    """Keyword-search Crossref → normalized candidates in Crossref's own relevance
    order. Free with no per-day credit cap, so this is the primary search source
    (OpenAlex is the fallback). Most records lack abstracts, so semantic rerank
    upstream simply no-ops and Crossref's relevance ranking stands.

    Raises httpx.HTTPError on network/HTTP failure; empty query returns []."""
    query = (query or "").strip()
    if not query:
        return []
    params: dict[str, Any] = {
        "query.bibliographic": query[:500],
        "rows": max(1, min(rows, 25)),
        "select": _SELECT,
        "mailto": _MAILTO,
    }
    if year_from:
        params["filter"] = f"from-pub-date:{year_from}-01-01"
    headers = {"User-Agent": f"thesis-llm-demo/1.0 (mailto:{_MAILTO})"}
    with httpx.Client(timeout=_TIMEOUT, headers=headers) as cli:
        resp = cli.get(_SEARCH, params=params)
        resp.raise_for_status()
        items = (resp.json().get("message") or {}).get("items") or []
    # Skip metadata-only stubs with no usable title (empty string or missing).
    return [_normalize(it) for it in items if (it.get("title") or [""])[0].strip()]


def lookup_doi(doi_or_url: str) -> dict[str, Any] | None:
    """Resolve a DOI (or URL containing one) → normalized candidate, or None if
    no DOI is present / the DOI is unknown. Raises httpx.HTTPError on a real
    network/HTTP failure."""
    doi = extract_doi(doi_or_url)
    if not doi:
        return None
    headers = {"User-Agent": f"thesis-llm-demo/1.0 (mailto:{_MAILTO})"}
    with httpx.Client(timeout=_TIMEOUT, headers=headers) as cli:
        resp = cli.get(_WORKS + doi, params={"mailto": _MAILTO})
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        msg = resp.json().get("message")
    return _normalize(msg) if msg else None
