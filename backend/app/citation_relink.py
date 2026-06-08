"""High-confidence citation relinking for imported papers.

Imported references are plain text (an import can't recover the OpenAlex metadata
an export discarded). This rebuilds them into live citations — but ONLY when we're
confident, because linking to the WRONG paper is worse than not linking:

  1. Find the reference-list entries (after the 參考文獻 / References heading).
  2. LLM-parse each into {title, first_author_surname, year, is_academic}.
  3. For academic entries, search OpenAlex by title and accept the match ONLY if
     the found work's title is a strong semantic match (embedding cosine ≥ τ).
  4. Replace matching in-text markers (Surname, year) with live citation nodes;
     the reference list then regenerates itself from those citations.

Chinese theses and web resources (which OpenAlex doesn't index) stay plain text.
"""
from __future__ import annotations

import math
import re
import threading
import time
from typing import Any

from . import llm, openalex
from .prompts import load_prompt

# Relink is heavy (LLM parse + N OpenAlex searches + embeddings). It's user-
# initiated and rare, but cap per-doc as a backstop against a stuck client.
_RATE_LIMIT_PER_MIN = 3
_rate_lock = threading.Lock()
_rate_buckets: dict[str, list[float]] = {}


def check_rate_limit(doc_id: str) -> tuple[bool, int]:
    now = time.monotonic()
    with _rate_lock:
        bucket = [t for t in _rate_buckets.get(doc_id, []) if now - t < 60]
        if len(bucket) >= _RATE_LIMIT_PER_MIN:
            _rate_buckets[doc_id] = bucket
            return False, int(60 - (now - bucket[0])) + 1
        bucket.append(now)
        _rate_buckets[doc_id] = bucket
        return True, 0

_REF_HEADING = re.compile(r"參考文獻|參考書目|引用文獻|References|Bibliography", re.I)
_SIM_THRESHOLD = 0.80  # parsed-title ↔ OpenAlex-title cosine; below this we don't link

_PARSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "refs": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "title": {"type": "string"},
                    "first_author_surname": {"type": "string"},
                    "year": {"type": "integer"},
                    "is_academic": {"type": "boolean"},
                },
                "required": ["index", "is_academic"],
            },
        }
    },
    "required": ["refs"],
}


def _node_text(node: dict) -> str:
    if node.get("type") == "text":
        return node.get("text", "")
    return "".join(_node_text(c) for c in node.get("content", []))


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na and nb else 0.0


def reference_lines(content: dict) -> list[str]:
    """Reference-list entries: non-trivial paragraphs after the references heading."""
    out: list[str] = []
    started = False
    for b in content.get("content", []):
        if b.get("type") == "heading" and _REF_HEADING.search(_node_text(b)):
            started = True
            continue
        # Reference entries import as paragraph / heading / blockquote depending on
        # the source DOCX styling (a thesis often styles its bibliography oddly).
        if started and b.get("type") in ("paragraph", "heading", "blockquote"):
            t = _node_text(b).strip()
            if len(t) > 12:
                out.append(t)
    return out


def parse_references(lines: list[str]) -> list[dict]:
    """LLM batch-parse reference strings → structured records (best-effort)."""
    if not lines:
        return []
    numbered = "\n".join(f"[{i}] {ln}" for i, ln in enumerate(lines))
    try:
        result = llm.call_with_tool(
            model=llm.model_light(),
            system=load_prompt("citation_parse"),
            user_content=numbered[:24000],
            tool_name="parsed_references",
            tool_description="Return every reference parsed into structured fields.",
            tool_input_schema=_PARSE_SCHEMA,
            max_tokens=8000,
            stage="citation_parse",
        )
    except Exception:  # noqa: BLE001 — no quota / API blip → nothing to link
        return []
    refs = result.get("refs", [])
    for r in refs:
        i = r.get("index")
        if isinstance(i, int) and 0 <= i < len(lines):
            r["raw"] = lines[i]
    return refs


def high_confidence_matches(parsed: list[dict]) -> list[dict]:
    """Search OpenAlex for each academic ref; keep only strong title matches.

    Returns the parsed record augmented with `openalex` (normalized candidate)
    and `similarity`. Conservative by design — a weak match is dropped, not linked.
    """
    matched: list[dict] = []
    for r in parsed:
        title = (r.get("title") or "").strip()
        if not r.get("is_academic") or len(title) < 8:
            continue
        try:
            cands = openalex.search_works(title, per_page=3)
        except Exception:  # noqa: BLE001 — network blip → skip this ref
            continue
        cands = [c for c in cands if c.get("title")]
        if not cands:
            continue
        try:
            vecs = llm.embed([title] + [c["title"] for c in cands])
        except Exception:  # noqa: BLE001 — no quota → can't verify → skip
            continue
        qv = vecs[0]
        cand, sim = max(
            ((c, _cosine(qv, v)) for c, v in zip(cands, vecs[1:])),
            key=lambda p: p[1],
        )
        if sim >= _SIM_THRESHOLD:
            matched.append({**r, "openalex": cand, "similarity": round(sim, 3)})
    return matched


# ---------- in-text replacement → live citation nodes ----------

# An in-text marker like "(boyd & Ellison, 2007)" or "(Bhattacherjee, 2001)".
_PAREN_RE = re.compile(r"[（(]([^（()）]{2,90}?)[）)]")
_YEAR_RE = re.compile(r"(19|20)\d{2}")


def _to_citation_attrs(cand: dict) -> dict:
    """OpenAlex normalized candidate → the editor's citation node attrs."""
    return {
        "openalexId": cand.get("openalex_id", ""),
        "authors": ", ".join(cand.get("authors", [])),
        "year": cand.get("year"),
        "title": cand.get("title", ""),
        "venue": cand.get("venue", ""),
        "doi": cand.get("doi", ""),
        "oaUrl": cand.get("oa_url", ""),
        "url": cand.get("url", ""),
    }


def _surname_token(authors_part: str) -> str:
    """First author's surname from the text before the year, lowercased."""
    first = re.split(r"\s*(?:&|et al\.?|,|，|and|與|；|;)\s*", authors_part.strip())[0]
    return first.strip().strip(",，.").lower()


def _build_index(matches: list[dict]) -> dict[tuple[str, int], dict]:
    """{(surname, year): citation_attrs} from the high-confidence matches."""
    idx: dict[tuple[str, int], dict] = {}
    for m in matches:
        surname = (m.get("first_author_surname") or "").strip().lower()
        year = m.get("year")
        if surname and isinstance(year, int):
            idx[(surname, year)] = _to_citation_attrs(m["openalex"])
    return idx


def _lookup(paren_content: str, index: dict) -> dict | None:
    ym = _YEAR_RE.search(paren_content)
    if not ym:
        return None
    year = int(ym.group(0))
    before = paren_content[: ym.start()]
    surname = _surname_token(before)
    if not surname:
        return None
    return index.get((surname, year))


def _relink_inline(nodes: list[dict], index: dict, stats: dict) -> list[dict]:
    """Replace matched (Author, year) markers in a text node with citation atoms."""
    out: list[dict] = []
    for n in nodes:
        if n.get("type") != "text":
            out.append(n)
            continue
        text = n.get("text", "")
        marks = n.get("marks")
        pos = 0
        pieces: list[dict] = []
        for m in _PAREN_RE.finditer(text):
            attrs = _lookup(m.group(1), index)
            if not attrs:
                continue
            if m.start() > pos:
                seg = {"type": "text", "text": text[pos:m.start()]}
                if marks:
                    seg["marks"] = marks
                pieces.append(seg)
            pieces.append({"type": "citation", "attrs": attrs})
            stats["intext_linked"] += 1
            pos = m.end()
        if not pieces:
            out.append(n)
            continue
        if pos < len(text):
            seg = {"type": "text", "text": text[pos:]}
            if marks:
                seg["marks"] = marks
            pieces.append(seg)
        out.extend(pieces)
    return out


def _walk_relink(node: dict, index: dict, stats: dict) -> None:
    content = node.get("content")
    if not content:
        return
    if any(c.get("type") == "text" for c in content):
        node["content"] = _relink_inline(content, index, stats)
    for c in node.get("content", []):
        _walk_relink(c, index, stats)


def relink(content: dict, doc_id: str | None = None) -> dict:
    """Full pipeline: parse references → high-confidence OpenAlex match → replace
    in-text (Author, year) markers with live citation nodes. Returns
    {content_json, stats}. The reference panel regenerates from the new nodes."""
    lines = reference_lines(content)
    parsed = parse_references(lines)
    matches = high_confidence_matches(parsed)
    index = _build_index(matches)
    stats = {
        "references": len(lines),
        "academic": sum(1 for r in parsed if r.get("is_academic") and r.get("title")),
        "matched": len(matches),
        "intext_linked": 0,
    }
    if index:
        for block in content.get("content", []):
            _walk_relink(block, index, stats)
    return {"content_json": content, "stats": stats}
