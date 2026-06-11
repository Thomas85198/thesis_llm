"""End-to-end extraction with PDF coordinate preservation:
PDF/text → spans (with page+bbox) → sections → EDU (mapped back to bbox)
        → ER → RST/FRU → PaperGraph
"""
from __future__ import annotations

import os
import re
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import pymupdf
from rapidfuzz import fuzz

from .llm import (
    LLMOutputTruncatedError,
    call_with_tool,
    llm_max_workers,
    model_heavy,
    model_light,
)
from .prompts import load_prompt
from .schemas import EDU, ERTriple, Entity, FRUNode, PaperGraph, RSTNode, SectionName


@dataclass
class Span:
    """A contiguous piece of text from the PDF with its page + bbox."""
    page: int
    bbox: tuple[float, float, float, float]  # x0, y0, x1, y1
    text: str
    char_start: int  # offset into the full document text
    char_end: int


# Optional leading section number before a heading word. Handles both
# Arabic ("1." / "1 " / "1.2 ") and Chinese ("一、" / "二." / "（三）") numbering
# common in zh-TW theses — without this, "一、緒論" never matches and the whole
# paper collapses into one giant "Other" section.
_SEC_NUM = r"(?:[（(]?\s*(?:\d+(?:\.\d+)*\.?|[一二三四五六七八九十百]+)\s*[)）、.．]?\s*)?"

SECTION_PATTERNS: list[tuple[SectionName, re.Pattern[str]]] = [
    ("Abstract", re.compile(r"^\s*(摘要|abstract)\b", re.IGNORECASE | re.MULTILINE)),
    (
        "Introduction",
        re.compile(rf"^\s*{_SEC_NUM}(introduction|引言|緒論|前言)\b", re.IGNORECASE | re.MULTILINE),
    ),
    ("Method", re.compile(rf"^\s*{_SEC_NUM}(method(s|ology)?|方法|研究方法)\b", re.IGNORECASE | re.MULTILINE)),
    (
        "Experiment",
        re.compile(rf"^\s*{_SEC_NUM}(experiment(s)?|實驗)\b", re.IGNORECASE | re.MULTILINE),
    ),
    ("Results", re.compile(rf"^\s*{_SEC_NUM}(results?|結果)\b", re.IGNORECASE | re.MULTILINE)),
    (
        "Discussion",
        re.compile(rf"^\s*{_SEC_NUM}(discussion|討論|分析)\b", re.IGNORECASE | re.MULTILINE),
    ),
    (
        "Conclusion",
        re.compile(rf"^\s*{_SEC_NUM}(conclusion(s)?|結論|總結)\b", re.IGNORECASE | re.MULTILINE),
    ),
]

EXCLUDED_SECTIONS: set[SectionName] = set()


# ---------- PDF / text extraction ----------

def extract_spans_from_bytes(
    data: bytes,
    filename: str,
    on_ocr_fallback: Callable[[], None] | None = None,
) -> list[Span]:
    """Read a PDF (or plain text) into Spans with page+bbox.

    For .txt input we synthesize a single span per line (page=0, dummy bbox).

    `on_ocr_fallback` fires right before the OCR pass starts, so the upload
    handler can flip the job status message to warn the user about the long
    wait. Only called for PDFs that fail garble detection.
    """
    if filename.lower().endswith(".pdf"):
        return _extract_pdf_spans(data, on_ocr_fallback=on_ocr_fallback)
    return _extract_text_spans(data.decode("utf-8", errors="replace"))


def _extract_pdf_spans(
    data: bytes,
    on_ocr_fallback: Callable[[], None] | None = None,
) -> list[Span]:
    """Native PDF text extraction, with OCR fallback when output is garbled.

    Some LaTeX-built PDFs embed Type 3 fonts without a ToUnicode CMap. PyMuPDF
    then returns raw glyph indices (looks like "*?Ti2`" instead of "Chapter").
    We detect that and re-run via tesseract — slow, but the only path that
    recovers readable text.
    """
    spans = _extract_pdf_spans_native(data)
    if _looks_garbled(spans):
        if on_ocr_fallback is not None:
            on_ocr_fallback()
        ocr_spans = _extract_pdf_spans_ocr(data)
        if ocr_spans:
            return ocr_spans
    return spans


def _extract_pdf_spans_native(data: bytes, textpage_fn=None) -> list[Span]:
    spans: list[Span] = []
    cursor = 0
    doc = pymupdf.open(stream=data, filetype="pdf")
    try:
        for page_num in range(len(doc)):
            page = doc[page_num]
            if textpage_fn is not None:
                tp = textpage_fn(page)
                page_dict = page.get_text("dict", textpage=tp)
            else:
                page_dict = page.get_text("dict")
            blocks = page_dict.get("blocks", [])
            for block in blocks:
                if block.get("type") != 0:  # 0 = text block
                    continue
                for line in block.get("lines", []):
                    line_text = "".join(sp.get("text", "") for sp in line.get("spans", []))
                    line_text = line_text.strip()
                    if not line_text:
                        continue
                    line_bbox = line.get("bbox") or block.get("bbox")
                    text_with_nl = line_text + "\n"
                    spans.append(
                        Span(
                            page=page_num,
                            bbox=tuple(line_bbox),
                            text=text_with_nl,
                            char_start=cursor,
                            char_end=cursor + len(text_with_nl),
                        )
                    )
                    cursor += len(text_with_nl)
            cursor += 1  # extra newline between pages
    finally:
        doc.close()
    return spans


# Punctuation that's near-zero in natural prose but dominates the substitution-
# cipher-style output of LaTeX PDFs with broken/missing ToUnicode CMaps.
# (PyMuPDF can leak glyph indices as e.g. "*?Ti2`" for what should be "Chapter".)
_GARBLE_HINT_CHARS = frozenset("`*~^|")


def _looks_garbled(spans: list[Span]) -> bool:
    """True when extracted text looks like glyph-index leakage rather than
    real characters. Drives the OCR fallback in `_extract_pdf_spans`.

    The signal we rely on: in natural English/CJK prose, backtick + asterisk
    + tilde + caret + pipe together occupy well under 1% of characters. In
    glyph-cipher output they routinely occupy 5–15%. That's a >10x gap, so a
    single threshold is enough — earlier attempts that also gated on a
    "real letter ratio" missed this PDF because the cipher rotates letters
    to *other* letters, keeping the alphabetic ratio high.
    """
    sample = "".join(s.text for s in spans[:80])[:4000]
    if len(sample) < 200:
        # Too little text to judge confidently; skip OCR (avoids OCR-ing
        # legitimately tiny one-page docs).
        return False
    hint = sum(1 for c in sample if c in _GARBLE_HINT_CHARS)
    return (hint / len(sample)) > 0.03


def _extract_pdf_spans_ocr(data: bytes) -> list[Span]:
    """OCR fallback for PDFs whose native text layer is unusable.

    Uses PyMuPDF's tesseract integration (`page.get_textpage_ocr`) so we keep
    the same bbox-preserving Span output. Requires tesseract + chi_tra/eng
    traineddata in the runtime image (installed via the Dockerfile).

    DPI 200 is a balance — 300 is sharper but ~2x slower per page; 150 starts
    losing CJK strokes.
    """
    def _ocr_textpage(page):
        return page.get_textpage_ocr(language="chi_tra+eng", dpi=200, full=True)

    try:
        return _extract_pdf_spans_native(data, textpage_fn=_ocr_textpage)
    except Exception as exc:  # tesseract missing, bad lang pack, etc.
        # Bubble up a clear error so the upload endpoint surfaces it instead of
        # silently returning the original garbled spans.
        raise RuntimeError(
            "PDF text is garbled and OCR fallback failed. "
            "Check that tesseract + chi_tra are installed in the backend image."
        ) from exc


def _extract_text_spans(text: str) -> list[Span]:
    spans: list[Span] = []
    cursor = 0
    for line in text.splitlines(keepends=True):
        if line.strip():
            spans.append(
                Span(
                    page=0,
                    bbox=(0.0, 0.0, 0.0, 0.0),
                    text=line,
                    char_start=cursor,
                    char_end=cursor + len(line),
                )
            )
        cursor += len(line)
    return spans


def spans_to_text(spans: list[Span]) -> str:
    return "".join(s.text for s in spans)


# ---------- Section split ----------

def split_sections_with_spans(
    spans: list[Span],
) -> list[tuple[SectionName, list[Span]]]:
    """Heuristic section split that preserves span boundaries.

    Each section gets the spans whose char range falls within that section.
    """
    text = spans_to_text(spans)
    matches: list[tuple[int, SectionName]] = []
    for name, pattern in SECTION_PATTERNS:
        for m in pattern.finditer(text):
            matches.append((m.start(), name))
    matches.sort()

    if not matches:
        return [("Other", spans)]

    boundaries: list[tuple[SectionName, int, int]] = []
    if matches[0][0] > 0:
        boundaries.append(("Abstract", 0, matches[0][0]))
    for i, (start, name) in enumerate(matches):
        end = matches[i + 1][0] if i + 1 < len(matches) else len(text)
        boundaries.append((name, start, end))

    out: list[tuple[SectionName, list[Span]]] = []
    for name, start, end in boundaries:
        section_spans = [s for s in spans if s.char_start < end and s.char_end > start]
        out.append((name, section_spans))
    return out


# ---------- EDU localization (text → page+bbox) ----------

def _locate_edu_in_spans(
    edu_text: str, section_spans: list[Span]
) -> tuple[int, list[float]]:
    """Find which page+bbox best covers this EDU's text.

    Strategy:
    1. Concatenate section text, find substring offset (exact or fuzzy).
    2. Look up which spans cover that offset range.
    3. Return first span's page + bbox-union of all covering spans on that page.
    """
    if not section_spans:
        return 0, [0.0, 0.0, 0.0, 0.0]

    section_text = spans_to_text(section_spans)
    section_offset = section_spans[0].char_start
    needle = " ".join(edu_text.split())[:200]
    if not needle:
        return section_spans[0].page, list(section_spans[0].bbox)

    haystack = " ".join(section_text.split())
    idx = haystack.find(needle)

    if idx < 0:
        # Fuzzy fallback: scan in steps, pick window with highest similarity.
        best_score = 0
        best_idx = 0
        step = max(1, len(haystack) // 200)
        for i in range(0, max(1, len(haystack) - len(needle)), step):
            score = fuzz.partial_ratio(needle, haystack[i : i + len(needle) + 50])
            if score > best_score:
                best_score = score
                best_idx = i
        if best_score < 60:
            return section_spans[0].page, list(section_spans[0].bbox)
        idx = best_idx

    proportion = idx / max(1, len(haystack))
    approx_char = section_offset + int(proportion * len(section_text))
    needle_end_char = approx_char + len(edu_text)

    covering = [
        s
        for s in section_spans
        if s.char_start < needle_end_char and s.char_end > approx_char
    ]
    if not covering:
        return section_spans[0].page, list(section_spans[0].bbox)

    page = covering[0].page
    same_page = [s for s in covering if s.page == page]
    x0 = min(s.bbox[0] for s in same_page)
    y0 = min(s.bbox[1] for s in same_page)
    x1 = max(s.bbox[2] for s in same_page)
    y1 = max(s.bbox[3] for s in same_page)
    return page, [x0, y0, x1, y1]


# ---------- LLM-driven extraction ----------

EDU_SCHEMA = {
    "type": "object",
    "properties": {
        "edus": {
            "type": "array",
            "description": "Elementary Discourse Units in reading order.",
            "items": {
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
            },
        }
    },
    "required": ["edus"],
}

# Prompts now live in backend/prompts/*.md so 學長 can edit without Python.
# Loaded lazily via load_prompt(name) — see app/prompts.py.


def _edu_chunk_max_chars() -> int:
    """Max characters of section text per emit_edus call.

    EDUs preserve the original wording, so output size ≈ input size plus JSON
    overhead per EDU — and table/appendix text degenerates into many tiny EDUs
    ("86/652", "=", "and"), inflating that overhead severalfold. A section that
    swallows a large appendix (the last matched section runs to end-of-document)
    can blow past call_with_tool's 32k output cap and come back truncated.
    8000 chars keeps the worst case (token-dense zh + degenerate splitting)
    comfortably under the cap."""
    try:
        return max(1000, int(os.getenv("EDU_CHUNK_MAX_CHARS", "8000")))
    except ValueError:
        return 8000


def _chunk_spans_by_chars(spans: list[Span], max_chars: int) -> list[list[Span]]:
    """Greedily pack consecutive spans into chunks of ≤ max_chars of text.

    Spans are the smallest unit we can split at without losing page/bbox
    mapping; a single span longer than max_chars becomes its own chunk."""
    chunks: list[list[Span]] = []
    current: list[Span] = []
    current_len = 0
    for s in spans:
        span_len = len(s.text)
        if current and current_len + span_len > max_chars:
            chunks.append(current)
            current, current_len = [], 0
        current.append(s)
        current_len += span_len
    if current:
        chunks.append(current)
    return chunks


def _emit_edus_for_spans(
    section: SectionName, spans: list[Span], paper_id: str
) -> list[tuple[str, list[Span]]]:
    """emit_edus over these spans; returns (edu_text, source_spans) pairs.

    If the output still hits the token cap (pathologically EDU-dense text),
    split the spans in half and recurse — retrying the same input at
    temperature 0 would just truncate again."""
    text = spans_to_text(spans).strip()
    if not text:
        return []
    try:
        out = call_with_tool(
            model=model_light(),
            system=load_prompt("edu"),
            user_content=f"<section name='{section}'>\n{text}\n</section>",
            tool_name="emit_edus",
            tool_description="Emit EDUs for the section.",
            tool_input_schema=EDU_SCHEMA,
            paper_id=paper_id,
            stage=f"edu:{section}",
        )
    except LLMOutputTruncatedError:
        if len(spans) < 2:
            raise
        mid = len(spans) // 2
        print(
            f"[pipeline] edu:{section} output truncated for a "
            f"{len(text)}-char chunk — splitting {len(spans)} spans in half"
        )
        return _emit_edus_for_spans(
            section, spans[:mid], paper_id
        ) + _emit_edus_for_spans(section, spans[mid:], paper_id)
    return [(item["text"], spans) for item in out.get("edus", [])]


def extract_edus(
    section: SectionName, section_spans: list[Span], paper_id: str
) -> list[EDU]:
    section_text = spans_to_text(section_spans).strip()
    if not section_text:
        return []
    # Long sections (the last one swallows references + appendices) are split
    # into chunks so each emit_edus output stays under the token cap. Each EDU
    # is localized within its own chunk's spans — same result as section-wide
    # lookup for exact matches, and less ambiguity for the fuzzy fallback.
    pairs: list[tuple[str, list[Span]]] = []
    for chunk in _chunk_spans_by_chars(section_spans, _edu_chunk_max_chars()):
        pairs.extend(_emit_edus_for_spans(section, chunk, paper_id))
    edus: list[EDU] = []
    for i, (text, chunk_spans) in enumerate(pairs):
        page, bbox = _locate_edu_in_spans(text, chunk_spans)
        edus.append(
            EDU(
                id=f"{paper_id}:{section}:edu:{i}",
                text=text,
                section=section,
                order=i,
                page=page,
                bbox=bbox,
            )
        )
    return edus


ER_SCHEMA = {
    "type": "object",
    "properties": {
        "entities": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "type": {
                        "type": "string",
                        "enum": [
                            "Concept",
                            "Method",
                            "Metric",
                            "Dataset",
                            "Model",
                            "Task",
                            "Claim",
                            "Other",
                        ],
                    },
                },
                "required": ["name", "type"],
            },
        },
        "triples": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "source": {"type": "string"},
                    "predicate": {"type": "string"},
                    "target": {"type": "string"},
                    "evidence_edu_index": {"type": "integer"},
                },
                "required": ["source", "predicate", "target", "evidence_edu_index"],
            },
        },
    },
    "required": ["entities", "triples"],
}

ENTITY_TYPES = {
    "Concept", "Method", "Metric", "Dataset", "Model", "Task", "Claim", "Other",
}


def extract_er(edus: list[EDU], paper_id: str) -> tuple[list[Entity], list[ERTriple]]:
    if not edus:
        return [], []
    indexed = "\n".join(f"[{i}] {e.text}" for i, e in enumerate(edus))
    section_label = edus[0].section if edus else "unknown"
    out = call_with_tool(
        model=model_light(),
        system=load_prompt("er"),
        user_content=f"<edus>\n{indexed}\n</edus>",
        tool_name="emit_er",
        tool_description="Emit entities and relation triples.",
        tool_input_schema=ER_SCHEMA,
        paper_id=paper_id,
        stage=f"er:{section_label}",
    )
    name_to_id: dict[str, str] = {}
    entities: list[Entity] = []
    for ent in out.get("entities", []):
        name = (ent.get("name") or "").strip()
        if not name or name in name_to_id:
            continue
        eid = f"{paper_id}:ent:{uuid.uuid4().hex[:8]}"
        name_to_id[name] = eid
        ent_type = ent.get("type", "Other")
        if ent_type not in ENTITY_TYPES:
            ent_type = "Other"
        entities.append(Entity(id=eid, name=name, type=ent_type))
    triples: list[ERTriple] = []
    for tr in out.get("triples", []):
        # The schema marks source/predicate/target as required, but OpenAI's
        # tool calling doesn't strictly enforce it — skip malformed triples
        # rather than KeyError out of the whole pipeline.
        src, tgt, pred = tr.get("source"), tr.get("target"), tr.get("predicate")
        if not src or not tgt or not pred:
            continue
        s, t = src.strip(), tgt.strip()
        if s not in name_to_id or t not in name_to_id:
            continue
        idx = tr.get("evidence_edu_index", 0)
        if not 0 <= idx < len(edus):
            continue
        triples.append(
            ERTriple(
                id=f"{paper_id}:rel:{uuid.uuid4().hex[:8]}",
                source_entity_id=name_to_id[s],
                target_entity_id=name_to_id[t],
                predicate=pred,
                evidence_edu_id=edus[idx].id,
            )
        )
    return entities, triples


RST_FRU_SCHEMA = {
    "type": "object",
    "properties": {
        "rst": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "rst_type": {
                        "type": "string",
                        "enum": [
                            "Elaboration",
                            "Background",
                            "Cause",
                            "Result",
                            "Contrast",
                            "Concession",
                            "Evidence",
                            "Justify",
                            "Motivation",
                            "Solutionhood",
                            "Sequence",
                            "Restatement",
                            "Summary",
                            "Condition",
                            "Other",
                        ],
                    },
                    "nucleus_edu_index": {"type": "integer"},
                    "satellite_edu_indices": {
                        "type": "array",
                        "items": {"type": "integer"},
                    },
                },
                "required": ["rst_type", "nucleus_edu_index", "satellite_edu_indices"],
            },
        },
        "fru": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "function": {
                        "type": "string",
                        "enum": [
                            "Motivation",
                            "Claim",
                            "Evidence",
                            "Background",
                            "Definition",
                            "MethodStep",
                            "Observation",
                            "Attribution",
                            "Concession",
                            "Compensation",
                            "Specific",
                            "Generalization",
                            "Restatement",
                            "MetaDiscourse",
                            "Other",
                        ],
                    },
                    "edu_indices": {
                        "type": "array",
                        "items": {"type": "integer"},
                    },
                    "summary": {"type": "string"},
                },
                "required": ["function", "edu_indices", "summary"],
            },
        },
    },
    "required": ["rst", "fru"],
}

RST_RELATION_TYPES = {
    "Elaboration", "Background", "Cause", "Result", "Contrast", "Concession",
    "Evidence", "Justify", "Motivation", "Solutionhood", "Sequence",
    "Restatement", "Summary", "Condition", "Other",
}
FRU_FUNCTIONS = {
    "Motivation", "Claim", "Evidence", "Background", "Definition", "MethodStep",
    "Observation", "Attribution", "Concession", "Compensation", "Specific",
    "Generalization", "Restatement", "MetaDiscourse", "Other",
}


def extract_rst_fru(
    edus: list[EDU], paper_id: str
) -> tuple[list[RSTNode], list[FRUNode]]:
    if not edus:
        return [], []
    indexed = "\n".join(f"[{i}] {e.text}" for i, e in enumerate(edus))
    section_label = edus[0].section if edus else "unknown"
    out = call_with_tool(
        model=model_heavy(),
        system=load_prompt("rst_fru"),
        user_content=f"<edus>\n{indexed}\n</edus>",
        tool_name="emit_rst_fru",
        tool_description="Emit RST relations and FRU groupings.",
        tool_input_schema=RST_FRU_SCHEMA,
        paper_id=paper_id,
        stage=f"rst_fru:{section_label}",
    )

    rst_nodes: list[RSTNode] = []
    for r in out.get("rst", []):
        n_idx = r.get("nucleus_edu_index", -1)
        if not 0 <= n_idx < len(edus):
            continue
        sats = [i for i in r.get("satellite_edu_indices", []) if 0 <= i < len(edus)]
        rst_type = r.get("rst_type", "Other")
        if rst_type not in RST_RELATION_TYPES:
            rst_type = "Other"
        rst_nodes.append(
            RSTNode(
                id=f"{paper_id}:rst:{uuid.uuid4().hex[:8]}",
                rst_type=rst_type,
                nucleus_edu_id=edus[n_idx].id,
                satellite_edu_ids=[edus[i].id for i in sats],
            )
        )

    fru_nodes: list[FRUNode] = []
    for f in out.get("fru", []):
        idxs = [i for i in f.get("edu_indices", []) if 0 <= i < len(edus)]
        if not idxs:
            continue
        function = f.get("function", "Other")
        if function not in FRU_FUNCTIONS:
            function = "Other"
        fru_nodes.append(
            FRUNode(
                id=f"{paper_id}:fru:{uuid.uuid4().hex[:8]}",
                function=function,
                edu_ids=[edus[i].id for i in idxs],
                summary=f.get("summary", ""),
            )
        )
    return rst_nodes, fru_nodes


# ---------- Orchestration ----------

_SectionResult = tuple[
    list[EDU], list[Entity], list[ERTriple], list[RSTNode], list[FRUNode]
]


def _process_section(
    section: SectionName, section_spans: list[Span], paper_id: str
) -> _SectionResult | None:
    """Run the full EDU→ER→RST/FRU extraction for one section.

    These three calls are dependent (ER and RST/FRU both consume the EDUs), so
    they stay sequential within a section. Sections themselves are independent
    and run concurrently — see build_paper_graph.
    """
    edus = extract_edus(section, section_spans, paper_id)
    if not edus:
        return None
    entities, triples = extract_er(edus, paper_id)
    rst, fru = extract_rst_fru(edus, paper_id)
    return edus, entities, triples, rst, fru


TITLE_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {
            "type": "string",
            "description": (
                "The paper's title verbatim, original language. "
                "Empty string if no clear title is present."
            ),
        }
    },
    "required": ["title"],
}


def detect_paper_title(spans: list[Span], paper_id: str | None = None) -> str:
    """Ask a light model for the paper's real title from its opening text.

    Academic papers put the title at the very top, so the first ~1500 chars are
    enough — one cheap gpt-5.4-mini call (~few hundred tokens). Returns "" when
    nothing title-like is found, so the caller can fall back to the filename.
    """
    head = spans_to_text(spans).strip()[:1500]
    if not head:
        return ""
    out = call_with_tool(
        model=model_light(),
        system=load_prompt("title"),
        user_content=f"<paper-opening>\n{head}\n</paper-opening>",
        tool_name="emit_title",
        tool_description="Emit the paper's title.",
        tool_input_schema=TITLE_SCHEMA,
        max_tokens=200,
        paper_id=paper_id,
        stage="title",
    )
    return str(out.get("title", "")).strip()


def build_paper_graph(
    spans: list[Span], title: str = "", paper_id: str | None = None
) -> PaperGraph:
    paper_id = paper_id or f"paper:{uuid.uuid4().hex[:8]}"
    sections = split_sections_with_spans(spans)
    work = [(s, sp) for s, sp in sections if s not in EXCLUDED_SECTIONS]

    all_edus: list[EDU] = []
    all_entities: list[Entity] = []
    all_triples: list[ERTriple] = []
    all_rst: list[RSTNode] = []
    all_fru: list[FRUNode] = []

    # Sections are independent → fan out across a bounded thread pool. The
    # OpenAI client, SQLite logging, and Neo4j sessions are all thread-safe
    # (fresh connection/session per call). pool.map preserves input order, so
    # the assembled graph is deterministic regardless of completion order.
    if work:
        with ThreadPoolExecutor(max_workers=llm_max_workers()) as pool:
            results = pool.map(
                lambda a: _process_section(a[0], a[1], paper_id), work
            )
            for res in results:
                if res is None:
                    continue
                edus, entities, triples, rst, fru = res
                all_edus.extend(edus)
                all_entities.extend(entities)
                all_triples.extend(triples)
                all_rst.extend(rst)
                all_fru.extend(fru)

    return PaperGraph(
        paper_id=paper_id,
        title=title,
        edus=all_edus,
        entities=all_entities,
        er_triples=all_triples,
        rst_nodes=all_rst,
        fru_nodes=all_fru,
    )
