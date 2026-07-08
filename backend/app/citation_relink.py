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
from typing import Any

from . import llm, openalex, ratelimit
from .prompts import load_prompt

# Relink is heavy (LLM parse + N OpenAlex searches + embeddings). It's user-
# initiated and rare, but cap per-doc as a backstop against a stuck client.
_RATE_LIMIT_PER_MIN = 3
_rate_lock = threading.Lock()
_rate_buckets: dict[str, list[float]] = {}


def check_rate_limit(doc_id: str) -> tuple[bool, int]:
    return ratelimit.check(_rate_buckets, _rate_lock, _RATE_LIMIT_PER_MIN, doc_id)


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
    # Stage 1: OpenAlex search per ref, queuing every title for ONE embed call
    # (this used to be one embeddings request per ref — 60 refs = 60 requests).
    pending: list[tuple[dict, list[dict], int]] = []  # (ref, cands, offset)
    texts: list[str] = []
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
        pending.append((r, cands, len(texts)))
        texts.append(title)
        texts.extend(c["title"] for c in cands)
    if not pending:
        return []
    try:
        vecs = llm.embed(texts)
    except Exception:  # noqa: BLE001 — no quota → can't verify anything → skip all
        return []

    matched: list[dict] = []
    for r, cands, off in pending:
        qv = vecs[off]
        cand, sim = max(
            ((c, _cosine(qv, v)) for c, v in zip(cands, vecs[off + 1 :])),
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


# A parenthetical may hold several works: "(A, 2016; B, 2014)" — split on ; first.
_MULTI_SPLIT = re.compile(r"\s*[;；]\s*")
# An author-like token: a Capitalized Latin word, or a run of CJK chars.
_AUTHOR_TOKEN = re.compile(r"[A-Z][A-Za-z.'\-]+|[一-鿿]{2,}")
# Web / non-academic hints inside a marker (Wikipedia, URLs, n.d.).
_WEB_HINT = re.compile(
    r"wiki|https?://|維基|\bn\.?\s?d\.?\b|無日期|retrieved|取自", re.I
)

# Narrative citation: author(s) in the running text, only the year parenthesized —
# "Bhattacherjee (2001)", "Guo 與 Li (2018)", "Sheldon et al. (2017)". The leading
# author must be a Capitalized Latin word (CJK separators/co-authors allowed); a
# pure-CJK lead is excluded so Chinese prose like "去年 (2020)" doesn't false-match.
_NARRATIVE_RE = re.compile(
    r"(?P<authors>[A-Z][A-Za-z.'\-]+"
    r"(?:\s*(?:,|，|、|&|and|與|et\s+al\.?)\s*(?:[A-Z][A-Za-z.'\-]+|[一-鿿]{2,}))*"
    r"(?:\s+et\s+al\.?)?)"
    r"\s*[（(](?P<year>(?:19|20)\d{2})[a-z]?[）)]"
)
# Single-token leads that are common non-author words → not a citation.
_NARR_STOPWORDS = {
    "table",
    "figure",
    "fig",
    "chapter",
    "section",
    "appendix",
    "equation",
    "eq",
    "vol",
    "no",
    "the",
    "this",
    "that",
    "in",
    "since",
    "around",
    "circa",
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
}


def _parse_narrative(authors_raw: str, year: int, raw: str) -> dict | None:
    """An author run + parenthesized year → parsed fields, or None if the lead is
    a stopword (e.g. "Figure (2020)")."""
    a = authors_raw.strip()
    surname = _surname_token(a)
    if not surname:
        return None
    tokens = _AUTHOR_TOKEN.findall(a)
    if len(tokens) <= 1 and surname in _NARR_STOPWORDS:
        return None
    authors = _norm_authors(a)
    return {
        "surname": surname,
        "year": year,
        "authors": authors or a,
        "web": False,
        "raw": raw.strip(),
    }


def _chip_for(ps: dict, index: dict, stats: dict, narrative: bool = False) -> dict:
    """Parsed segment → a citation atom: linked when a high-confidence source
    exists, else an unlinked (pending-source) chip."""
    linked = index.get((ps["surname"], ps["year"])) if ps["year"] is not None else None
    if linked:
        attrs = dict(linked)
        stats["intext_linked"] += 1
    else:
        attrs = _unlinked_attrs(ps)
        stats["intext_unlinked"] += 1
    if narrative:
        attrs["narrative"] = True
    return {"type": "citation", "attrs": attrs}


def _norm_authors(before: str) -> str:
    """Author text before the year → comma-joined names (so inTextLabel works)."""
    s = re.sub(r"\s*(?:&|et al\.?|and|與)\s*", ", ", before)
    return s.strip().strip(",，、. ")


def _parse_intext_segment(seg: str) -> dict | None:
    """One in-text citation segment → parsed fields, or None if not a citation.

    Needs an author-like token plus EITHER a year OR a web hint (Wikipedia / URL
    / n.d.), so non-citations like "(n=2009)" or "(see Eq. 3)" stay plain text
    while year-less web refs like "(Wikipedia, n.d.)" are still recognized."""
    ym = _YEAR_RE.search(seg)
    web = bool(_WEB_HINT.search(seg))
    if not ym and not web:
        return None
    before = seg[: ym.start()] if ym else seg
    if not _AUTHOR_TOKEN.search(before):
        return None
    surname = _surname_token(before)
    if not surname:
        return None
    authors = _norm_authors(before)
    # Drop a trailing "n.d." so a web ref reads "Wikipedia", not "Wikipedia, n.d".
    authors = re.sub(r",?\s*n\.?\s?d\.?\s*$", "", authors, flags=re.I).strip(", ")
    return {
        "surname": surname,
        "year": int(ym.group(0)) if ym else None,
        "authors": authors or before.strip(),
        "web": web,
        "raw": seg.strip(),
    }


def _unlinked_attrs(ps: dict) -> dict:
    """A recognized-but-unresolved citation chip (no source linked yet)."""
    return {
        "openalexId": "",
        "authors": ps["authors"],
        "year": ps["year"],
        "title": "",
        "venue": "",
        "doi": "",
        "oaUrl": "",
        "url": "",
        "unlinked": True,
        "kind": "web" if ps["web"] else "academic",
        "raw": ps["raw"],
    }


def _relink_inline(nodes: list[dict], index: dict, stats: dict) -> list[dict]:
    """Replace in-text citation markers in a text node with citation atoms.

    Two forms are recognized and merged in document order:
      • narrative — author in the prose, year parenthesized: "Smith (2020)";
      • parenthetical — "(Smith, 2020)", possibly multi-work "(A, 2016; B, 2014)".
    Narrative spans win over the bare "(year)" they contain. Each work links to a
    high-confidence source when one exists, else becomes an unlinked chip."""
    out: list[dict] = []
    for n in nodes:
        if n.get("type") != "text":
            out.append(n)
            continue
        text = n.get("text", "")
        marks = n.get("marks")

        def _seg(t: str) -> dict:
            s = {"type": "text", "text": t}
            if marks:
                s["marks"] = marks
            return s

        # (start, end, [chips]) spans. Narrative first; parenthetical skipped when
        # it overlaps a narrative span (the "(year)" inside it).
        spans: list[tuple[int, int, list[dict]]] = []
        narr: list[tuple[int, int]] = []
        for m in _NARRATIVE_RE.finditer(text):
            ps = _parse_narrative(m.group("authors"), int(m.group("year")), m.group(0))
            if not ps:
                continue
            spans.append((m.start(), m.end(), [_chip_for(ps, index, stats, True)]))
            narr.append((m.start(), m.end()))
        for m in _PAREN_RE.finditer(text):
            if any(a <= m.start() < b for a, b in narr):
                continue
            parsed = [_parse_intext_segment(s) for s in _MULTI_SPLIT.split(m.group(1))]
            if not any(parsed):
                continue  # not a citation paren — leave as plain text
            chips = [_chip_for(ps, index, stats) for ps in parsed if ps]
            if chips:
                spans.append((m.start(), m.end(), chips))
        if not spans:
            out.append(n)
            continue

        spans.sort(key=lambda s: s[0])
        pos = 0
        pieces: list[dict] = []
        for start, end, chips in spans:
            if start < pos:
                continue  # overlapping match already consumed — skip
            if start > pos:
                pieces.append(_seg(text[pos:start]))
            for i, chip in enumerate(chips):
                if i:
                    pieces.append(_seg("; "))  # separate multi-work chips
                pieces.append(chip)
            pos = end
        if pos < len(text):
            pieces.append(_seg(text[pos:]))
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
        "intext_unlinked": 0,
    }
    # Always scan: even with no resolved sources, recognize in-text citations as
    # (unlinked) chips so they're counted/listed and can get a source later.
    for block in content.get("content", []):
        _walk_relink(block, index, stats)
    return {"content_json": content, "stats": stats}
