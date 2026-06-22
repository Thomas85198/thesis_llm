"""OpenAlex client for Smart Citation: keyword-search academic works.

OpenAlex (https://openalex.org) is a free, key-less scholarly index. We send the
author's selected claim sentence as the search query and return the top
candidates, normalized to a flat shape the editor renders. No embedding /
re-ranking here — we trust OpenAlex's own `relevance_score` ordering (the MVP
ranking decision); semantic rerank is a later phase.
"""

from __future__ import annotations

import os
import re
import time
from typing import Any
from urllib.parse import urlparse

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
    "primary_location,locations,open_access,cited_by_count,type,"
    "abstract_inverted_index,relevance_score"
)

# OA full-text hosts we trust to actually resolve. OpenAlex's own
# `open_access.oa_url` frequently points at a flaky mirror (e.g. a scraped copy
# on some preprint clone) even when a rock-solid arXiv/PMC copy exists in
# `locations`. We only surface a "full text" link when it sits on one of these,
# so the button never sends the author to a dead page.
_TRUSTED_FULLTEXT_HOSTS = (
    "arxiv.org",
    "ncbi.nlm.nih.gov",  # incl. pmc.ncbi.nlm.nih.gov
    "europepmc.org",
    "aclanthology.org",
    "openreview.net",
    "proceedings.mlr.press",
    "proceedings.neurips.cc",
    "papers.nips.cc",
    "openaccess.thecvf.com",
    "dl.acm.org",
    "biorxiv.org",
    "medrxiv.org",
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


def _host(url: str) -> str:
    """Bare hostname of a URL, lowercased, without a leading www."""
    return urlparse(url).netloc.lower().removeprefix("www.")


def _is_trusted(host: str) -> bool:
    return any(host == h or host.endswith("." + h) for h in _TRUSTED_FULLTEXT_HOSTS)


def fulltext_url(work: dict[str, Any]) -> str:
    """A *trustworthy* open-access full-text link, or "" if none.

    We ignore OpenAlex's `open_access.oa_url` — for popular papers it often picks
    a scraped mirror that 404s while a stable arXiv/PMC copy sits in `locations`.
    Instead we scan every OA location, keep only links on a trusted host
    (prefer the landing/abstract page over a raw PDF), and return the best one.
    If nothing trustworthy exists we return "" so the caller can simply omit the
    full-text link rather than promise a dead one.
    """
    for prefer_landing in (True, False):  # pass 1: landing pages; pass 2: PDFs
        for loc in work.get("locations") or []:
            if not loc.get("is_oa"):
                continue
            url = loc.get("landing_page_url") if prefer_landing else loc.get("pdf_url")
            if not url:
                continue
            host = _host(url)
            if host.endswith("doi.org"):  # that's the DOI, not a full text
                continue
            if _is_trusted(host):
                return url
    return ""


def source_url(work: dict[str, Any]) -> str:
    """Always-resolvable link for "view source": trusted full text, else DOI,
    else the primary landing page, else the OpenAlex record (which always exists).
    """
    primary = (work.get("primary_location") or {}).get("landing_page_url")
    return fulltext_url(work) or work.get("doi") or primary or work.get("id") or ""


def normalize(work: dict[str, Any]) -> dict[str, Any]:
    """Flatten one OpenAlex Work into the editor's candidate shape."""
    oa_id = (work.get("id") or "").rsplit("/", 1)[
        -1
    ]  # ".../W2741809807" → "W2741809807"
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
        "oa_url": fulltext_url(work),  # trusted OA full text, "" if none resolves
        "url": source_url(work),  # always-resolvable source link
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
        "filter": ",".join(filters),
    }
    return [normalize(w) for w in _fetch_results(params)]


# A refresh re-fetches every citation in a document at once; cap the batch so a
# pathological doc can't fan out into a huge OpenAlex query.
REFRESH_MAX_IDS = 100


def get_works_by_ids(openalex_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Re-fetch works by OpenAlex id → {openalex_id: normalized candidate}.

    Used to refresh stale citation metadata (chiefly links that have rotted, or
    that predate the trusted-source logic). Ids that OpenAlex no longer knows
    (deleted / merged) simply won't appear in the result, so the caller can leave
    those citations untouched. Batched into OR-filtered queries (OpenAlex allows
    up to 50 ids per filter). Raises httpx.HTTPError on network/HTTP failure.
    """
    # Keep only well-formed work ids (W + digits). OpenAlex 400s the whole batch
    # if any id is malformed, so a single junk attr would otherwise sink the
    # refresh; dropping it just leaves that citation untouched.
    ids = [i.strip() for i in openalex_ids if re.fullmatch(r"W\d+", i.strip())][
        :REFRESH_MAX_IDS
    ]
    out: dict[str, dict[str, Any]] = {}
    for i in range(0, len(ids), 50):
        chunk = ids[i : i + 50]
        params = {"filter": "openalex_id:" + "|".join(chunk), "per-page": len(chunk)}
        for w in _fetch_results(params):
            norm = normalize(w)
            if norm["openalex_id"]:
                out[norm["openalex_id"]] = norm
    return out


def _fetch_results(params: dict[str, Any]) -> list[dict[str, Any]]:
    """GET the works endpoint with our standard select + polite-pool params.

    OpenAlex bursts can return 429 (Too Many Requests) / 503; these are usually
    transient, so retry a couple of times with a short backoff (honoring
    Retry-After) before giving up — most rate-limit blips clear within a second.
    """
    params = {**params, "mailto": _MAILTO, "select": _SELECT}
    headers = {"User-Agent": f"thesis-llm-demo/1.0 (mailto:{_MAILTO})"}
    with httpx.Client(timeout=_TIMEOUT, headers=headers) as cli:
        resp = None
        for attempt in range(3):
            resp = cli.get(_BASE_URL, params=params)
            if resp.status_code not in (429, 503):
                break
            ra = resp.headers.get("retry-after", "")
            delay = float(ra) if ra.isdigit() else 0.8 * (attempt + 1)
            time.sleep(min(delay, 3.0))
        assert resp is not None
        resp.raise_for_status()
        return resp.json().get("results") or []
