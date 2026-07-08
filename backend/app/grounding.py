"""Full-text sentence-level citation grounding.

Answers "which sentence in the cited paper supports my claim?". Fetches the
paper's open-access full text (PDF via the same PyMuPDF used by the analysis
pipeline), splits it into sentences, embeds them once (cached in SQLite under the
openalex_id), then ranks sentences by similarity to the claim. Degrades to the
abstract when no OA full text is fetchable — so there is always *some* grounding.

This goes beyond M1 (claim × abstract LLM verdict): it pinpoints the supporting
sentence in the actual source body, and it's cheap on repeat (cached chunks).
"""

from __future__ import annotations

import math
import re
import threading
from functools import lru_cache

import httpx
import pymupdf

from . import db, llm, openalex, ratelimit

_SENTENCE = re.compile(r".+?[。．.!?！？\n]+|.+\Z", re.S)
MIN_SENT_CHARS = 20  # skip headers / tiny fragments
MAX_CHUNKS = 400  # cap embeddings per paper (cost/latency)
TOP_K = 3
_TIMEOUT = 20.0
_MAX_FULLTEXT_BYTES = 30 * 1024 * 1024  # streamed download cap for OA PDFs
_UA = "thesis-llm-demo/1.0 (mailto:thesis-llm-demo@example.com)"

# Grounding fetches + embeds (heavy on first hit); cap per document.
RATE_LIMIT_PER_MIN = 20


class GroundingError(RuntimeError):
    """Full text / embedding fetch failed; routes map this to a 502."""


_rate_lock = threading.Lock()
_rate_buckets: dict[str, list[float]] = {}


def check_rate_limit(doc_id: str) -> tuple[bool, int]:
    """Return (allowed, seconds_until_next_slot). Sliding 60s window per doc."""
    return ratelimit.check(_rate_buckets, _rate_lock, RATE_LIMIT_PER_MIN, doc_id)


@lru_cache(maxsize=256)
def _claim_vec(claim: str) -> tuple[float, ...]:
    """Embed a claim once per process — users re-ground the same sentence a lot
    (retries, comparing citations); each repeat used to be a paid API call."""
    return tuple(llm.embed([claim])[0])


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na and nb else 0.0


def _split_sentences(text: str) -> list[str]:
    out: list[str] = []
    for m in _SENTENCE.findall(text):
        s = re.sub(r"\s+", " ", m).strip()
        if len(s) >= MIN_SENT_CHARS:
            out.append(s)
        if len(out) >= MAX_CHUNKS:
            break
    return out


def _pdf_url(oa_url: str) -> str:
    """Prefer a direct PDF. Our oa_url favors stable landing pages, but grounding
    needs the PDF body — for arXiv, rewrite /abs/ID → /pdf/ID."""
    m = re.search(r"arxiv\.org/abs/([\w.\-/]+)", oa_url)
    if m:
        return f"https://arxiv.org/pdf/{m.group(1)}"
    return oa_url


def _fetch_fulltext(oa_url: str) -> str:
    """Download + extract text from an OA full-text URL (PDF only in this slice)."""
    if not oa_url:
        return ""
    oa_url = _pdf_url(oa_url)
    try:
        with httpx.Client(
            timeout=_TIMEOUT, follow_redirects=True, headers={"User-Agent": _UA}
        ) as cli:
            # Streamed with a hard cap — .content buffered arbitrarily large
            # PDFs fully into memory.
            with cli.stream("GET", oa_url) as resp:
                resp.raise_for_status()
                ctype = resp.headers.get("content-type", "").lower()
                chunks: list[bytes] = []
                size = 0
                for chunk in resp.iter_bytes():
                    size += len(chunk)
                    if size > _MAX_FULLTEXT_BYTES:
                        return ""
                    chunks.append(chunk)
                data = b"".join(chunks)
    except httpx.HTTPError:
        return ""
    is_pdf = "pdf" in ctype or oa_url.lower().endswith(".pdf") or data[:4] == b"%PDF"
    if not is_pdf:
        return ""  # HTML landing pages not parsed in this slice
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
        text = "\n".join(page.get_text() for page in doc)
        doc.close()
        return text
    except Exception:  # noqa: BLE001 — corrupt/unsupported PDF
        return ""


def _ensure_chunks(openalex_id: str) -> tuple[list[dict], str]:
    """Return (chunks, source). Builds + caches on first use; reuses after.

    The full-text URL is re-derived server-side from OpenAlex. The client used
    to supply it directly, which let any caller point the fetch at internal
    hosts (SSRF) AND poison the shared per-openalex_id chunk cache for every
    other user.
    """
    cached = db.get_paper_chunks(openalex_id)
    if cached:
        if cached[0]["source"] == "none":
            return [], "none"
        return cached, cached[0]["source"]

    fetched = openalex.get_works_by_ids([openalex_id]).get(openalex_id, {})
    text = _fetch_fulltext(fetched.get("oa_url", ""))
    source = "fulltext"
    if not text.strip():
        text = fetched.get("abstract", "") or ""
        source = "abstract"
    sentences = _split_sentences(text)
    if not sentences:
        # Cache the negative outcome too — without this every repeat click
        # re-downloads the OA PDF just to rediscover there's nothing usable.
        db.upsert_paper_chunks(openalex_id, "none", [(0, "", [])])
        return [], "none"

    embeddings = llm.embed(sentences)
    db.upsert_paper_chunks(
        openalex_id,
        source,
        [(i, s, e) for i, (s, e) in enumerate(zip(sentences, embeddings))],
    )
    return db.get_paper_chunks(openalex_id), source


def ground(openalex_id: str, oa_url: str, claim: str, doc_id: str) -> dict:
    """Return {source, supporting:[{sentence, score}]} — top sentences in the
    cited source that match the claim. source: fulltext | abstract | none.

    `oa_url` is accepted for request-body compatibility but deliberately
    ignored — the fetch URL is re-derived from OpenAlex (see _ensure_chunks).
    """
    claim = claim.strip()
    if not claim or not openalex_id:
        return {"source": "none", "supporting": []}
    try:
        chunks, source = _ensure_chunks(openalex_id)
        if not chunks:
            return {"source": "none", "supporting": []}
        claim_vec = list(_claim_vec(claim))
    except Exception as exc:  # noqa: BLE001
        raise GroundingError(str(exc)) from exc

    scored = sorted(
        ((_cosine(claim_vec, c["embedding"]), c["text"]) for c in chunks),
        key=lambda t: t[0],
        reverse=True,
    )
    supporting = [
        {"sentence": text, "score": round(score, 4)} for score, text in scored[:TOP_K]
    ]
    return {"source": source, "supporting": supporting}
