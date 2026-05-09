"""End-to-end extraction with PDF coordinate preservation:
PDF/text → spans (with page+bbox) → sections → EDU (mapped back to bbox)
        → ER → RST/FRU → PaperGraph
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

import pymupdf
from rapidfuzz import fuzz

from .llm import call_with_tool, model_heavy, model_light
from .schemas import EDU, ERTriple, Entity, FRUNode, PaperGraph, RSTNode, SectionName


@dataclass
class Span:
    """A contiguous piece of text from the PDF with its page + bbox."""
    page: int
    bbox: tuple[float, float, float, float]  # x0, y0, x1, y1
    text: str
    char_start: int  # offset into the full document text
    char_end: int


SECTION_PATTERNS: list[tuple[SectionName, re.Pattern[str]]] = [
    ("Abstract", re.compile(r"^\s*(摘要|abstract)\b", re.IGNORECASE | re.MULTILINE)),
    (
        "Introduction",
        re.compile(r"^\s*(\d+\.?\s*)?(introduction|引言|緒論|前言)\b", re.IGNORECASE | re.MULTILINE),
    ),
    ("Method", re.compile(r"^\s*(\d+\.?\s*)?(method(s|ology)?|方法)\b", re.IGNORECASE | re.MULTILINE)),
    (
        "Experiment",
        re.compile(r"^\s*(\d+\.?\s*)?(experiment(s)?|實驗)\b", re.IGNORECASE | re.MULTILINE),
    ),
    ("Results", re.compile(r"^\s*(\d+\.?\s*)?(results?|結果)\b", re.IGNORECASE | re.MULTILINE)),
    (
        "Discussion",
        re.compile(r"^\s*(\d+\.?\s*)?(discussion|討論|分析)\b", re.IGNORECASE | re.MULTILINE),
    ),
    (
        "Conclusion",
        re.compile(r"^\s*(\d+\.?\s*)?(conclusion(s)?|結論|總結)\b", re.IGNORECASE | re.MULTILINE),
    ),
]

EXCLUDED_SECTIONS: set[SectionName] = set()


# ---------- PDF / text extraction ----------

def extract_spans_from_bytes(data: bytes, filename: str) -> list[Span]:
    """Read a PDF (or plain text) into Spans with page+bbox.

    For .txt input we synthesize a single span per line (page=0, dummy bbox).
    """
    if filename.lower().endswith(".pdf"):
        return _extract_pdf_spans(data)
    return _extract_text_spans(data.decode("utf-8", errors="replace"))


def _extract_pdf_spans(data: bytes) -> list[Span]:
    spans: list[Span] = []
    cursor = 0
    doc = pymupdf.open(stream=data, filetype="pdf")
    try:
        for page_num in range(len(doc)):
            page = doc[page_num]
            blocks = page.get_text("dict").get("blocks", [])
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

EDU_SYSTEM = (
    "You are a discourse-analysis expert. Split the given paper section into "
    "Elementary Discourse Units (EDUs). An EDU is a minimal clause that carries "
    "a single proposition. Preserve the original wording — do not paraphrase. "
    "Keep them in reading order. Output via the provided tool."
)


def extract_edus(
    section: SectionName, section_spans: list[Span], paper_id: str
) -> list[EDU]:
    section_text = spans_to_text(section_spans).strip()
    if not section_text:
        return []
    out = call_with_tool(
        model=model_light(),
        system=EDU_SYSTEM,
        user_content=f"<section name='{section}'>\n{section_text}\n</section>",
        tool_name="emit_edus",
        tool_description="Emit EDUs for the section.",
        tool_input_schema=EDU_SCHEMA,
        paper_id=paper_id,
        stage=f"edu:{section}",
    )
    edus: list[EDU] = []
    for i, item in enumerate(out.get("edus", [])):
        text = item["text"]
        page, bbox = _locate_edu_in_spans(text, section_spans)
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

ER_SYSTEM = (
    "You extract entities and binary relations from academic-paper EDUs. "
    "Use canonical entity names (deduplicate aliases). Predicates should be "
    "concise verbs/phrases (e.g. 'proposes', 'evaluates_on', 'outperforms', "
    "'is_a', 'measured_by'). Every triple must cite the EDU index it came from. "
    "Output via the provided tool."
)

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
        system=ER_SYSTEM,
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
        name = ent["name"].strip()
        if name in name_to_id:
            continue
        eid = f"{paper_id}:ent:{uuid.uuid4().hex[:8]}"
        name_to_id[name] = eid
        ent_type = ent.get("type", "Other")
        if ent_type not in ENTITY_TYPES:
            ent_type = "Other"
        entities.append(Entity(id=eid, name=name, type=ent_type))
    triples: list[ERTriple] = []
    for tr in out.get("triples", []):
        s, t = tr["source"].strip(), tr["target"].strip()
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
                predicate=tr["predicate"],
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

RST_FRU_SYSTEM = (
    "You annotate two layers over the EDUs:\n"
    "1) RST (Rhetorical Structure Theory) relations: each entry has a nucleus "
    "EDU and zero or more satellite EDUs, plus the relation type.\n"
    "2) FRU (Functional Rhetorical Units): each entry groups consecutive EDUs "
    "that together perform a single rhetorical function (Motivation, Claim, "
    "Evidence, etc.) with a one-sentence summary.\n"
    "Be conservative — prefer 'Other' over guessing. Output via the tool."
)

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
        system=RST_FRU_SYSTEM,
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

def build_paper_graph(
    spans: list[Span], title: str = "", paper_id: str | None = None
) -> PaperGraph:
    paper_id = paper_id or f"paper:{uuid.uuid4().hex[:8]}"
    sections = split_sections_with_spans(spans)

    all_edus: list[EDU] = []
    all_entities: list[Entity] = []
    all_triples: list[ERTriple] = []
    all_rst: list[RSTNode] = []
    all_fru: list[FRUNode] = []

    for section, section_spans in sections:
        if section in EXCLUDED_SECTIONS:
            continue
        edus = extract_edus(section, section_spans, paper_id)
        if not edus:
            continue
        entities, triples = extract_er(edus, paper_id)
        rst, fru = extract_rst_fru(edus, paper_id)
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
