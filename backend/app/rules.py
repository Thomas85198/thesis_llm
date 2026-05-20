"""Load 13 REL rules and run them against a Paper KG to detect defects.

Phase 2 addition: when past human judgments exist for a rule, inject the most
recent N correct + N wrong examples into the system prompt as few-shot calibration.
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import yaml

from . import db
from .kg import resolve_evidence_to_edus, run_cypher
from .llm import call_with_tool, model_cross_section, model_heavy
from .prompts import load_prompt
from .schemas import EDU, Defect, RuleRunMeta, Severity

RULES_FILE = Path(__file__).parent.parent / "rules.yaml"

EXAMPLES_PER_VERDICT = 4
MIN_EXAMPLES_TO_INJECT = 3  # below this, examples are too few to be reliable


def load_rules() -> list[dict[str, Any]]:
    data = yaml.safe_load(RULES_FILE.read_text(encoding="utf-8"))
    return data.get("rules", [])


VERDICT_SCHEMA = {
    "type": "object",
    "properties": {
        "verdicts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "candidate_index": {"type": "integer"},
                    "violates": {"type": "boolean"},
                    "severity": {"type": "string", "enum": ["high", "medium", "low"]},
                    "evidence_edu_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "section": {
                        "type": "string",
                        "enum": [
                            "Abstract",
                            "Introduction",
                            "Method",
                            "Experiment",
                            "Results",
                            "Discussion",
                            "Conclusion",
                            "Other",
                        ],
                    },
                    "description": {
                        "type": "string",
                        "description": "Why it violates the rule, in 繁體中文.",
                    },
                    "suggestion": {
                        "type": "string",
                        "description": "Concrete fix in 繁體中文.",
                    },
                    "confidence": {
                        "type": "number",
                        "minimum": 0.0,
                        "maximum": 1.0,
                        "description": (
                            "How confident you are this is a real defect. "
                            "0.9+ = unambiguous; 0.6-0.9 = likely; 0.3-0.6 = "
                            "uncertain (consider not flagging); <0.3 = should "
                            "have set violates=false."
                        ),
                    },
                },
                "required": [
                    "candidate_index",
                    "violates",
                    "severity",
                    "evidence_edu_ids",
                    "section",
                    "description",
                    "suggestion",
                    "confidence",
                ],
            },
        }
    },
    "required": ["verdicts"],
}


def _build_examples_block(examples: list[dict[str, Any]]) -> str:
    """Format past human judgments as few-shot calibration. Empty if too few."""
    if len(examples) < MIN_EXAMPLES_TO_INJECT:
        return ""

    lines: list[str] = [
        "\n\nPast human judgments on THIS rule (calibrate to these):",
    ]
    for ex in examples:
        marker = (
            "✓ CORRECT (real defect)"
            if ex["verdict"] == "correct"
            else "✗ FALSE POSITIVE (do NOT flag again)"
        )
        evidence = " | ".join((t or "")[:200] for t in ex["evidence_texts"][:2])
        lines.append(f"\n[{marker}]")
        if evidence:
            lines.append(f"  evidence: «{evidence[:400]}»")
        if ex.get("description"):
            lines.append(f"  why-flagged: {ex['description'][:200]}")
        if ex.get("note"):
            lines.append(f"  reviewer note: {ex['note'][:200]}")
    lines.append(
        "\nUse these to recalibrate your threshold. If a new candidate closely "
        "resembles a FALSE POSITIVE pattern above, set violates=false."
    )
    return "".join(lines)


def check_rule(
    rule: dict[str, Any], paper_id: str, paper_title: str = ""
) -> tuple[list[Defect], RuleRunMeta]:
    candidates = run_cypher(rule["candidate_query"], pid=paper_id)

    examples = db.get_judgment_examples(rule["id"], EXAMPLES_PER_VERDICT)
    examples_block = _build_examples_block(examples)
    examples_used = len(examples) if examples_block else 0

    meta = RuleRunMeta(
        rule_id=rule["id"],
        examples_used=examples_used,
        candidate_count=len(candidates),
        defect_count=0,
    )
    if not candidates:
        return [], meta

    payload = {
        "paper_id": paper_id,
        "paper_title": paper_title,
        "candidates": [{"index": i, **c} for i, c in enumerate(candidates)],
    }

    out = call_with_tool(
        model=model_heavy(),
        system=load_prompt("checker").format(
            rule_id=rule["id"],
            rule_name=rule["name"],
            rule_description=rule["description"],
            examples_block=examples_block,
        ),
        user_content=json.dumps(payload, ensure_ascii=False, default=str)[:120_000],
        tool_name="emit_verdicts",
        tool_description="Emit per-candidate verdicts on this rule.",
        tool_input_schema=VERDICT_SCHEMA,
        paper_id=paper_id,
        stage=f"rule_check:{rule['id']}",
    )

    defects: list[Defect] = []
    for v in out.get("verdicts", []):
        if not v.get("violates"):
            continue
        # Candidate subgraphs are FRU-based, so the LLM frequently cites FRU
        # node ids here — those don't resolve to a PDF location. Expand them to
        # the concrete EDU ids they cover so "在 PDF 中查看" always works.
        evidence_edu_ids = resolve_evidence_to_edus(v.get("evidence_edu_ids", []))
        defects.append(
            Defect(
                id=f"defect:{uuid.uuid4().hex[:8]}",
                rule_id=rule["id"],
                defect_type=rule["defect_label"],
                severity=Severity(v["severity"]),
                section=v["section"],
                evidence_edu_ids=evidence_edu_ids,
                description=v["description"],
                suggestion=v["suggestion"],
                confidence=_clamp_confidence(v.get("confidence")),
            )
        )
    meta.defect_count = len(defects)
    return defects, meta


def _clamp_confidence(value: Any) -> float | None:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f < 0.0:
        return 0.0
    if f > 1.0:
        return 1.0
    return f


def check_all_rules(
    paper_id: str, paper_title: str = ""
) -> tuple[list[Defect], list[RuleRunMeta]]:
    defects: list[Defect] = []
    metas: list[RuleRunMeta] = []
    for rule in load_rules():
        rule_defects, meta = check_rule(rule, paper_id, paper_title)
        defects.extend(rule_defects)
        metas.append(meta)
    return defects, metas


# ---------- Cross-section second pass (Opus 1M) ----------
# Some REL rules need to compare evidence ACROSS sections (e.g. Conclusion's
# restatement vs Introduction's claim). Per-section Cypher candidates can't
# see both sides — so after the per-section sweep we do one Opus 1M pass with
# the whole paper in context.

CROSS_SECTION_RULES = ["REL-04", "REL-08", "REL-12"]
SECTION_ORDER = [
    "Abstract",
    "Introduction",
    "Method",
    "Experiment",
    "Results",
    "Discussion",
    "Conclusion",
    "Other",
]


CROSS_SECTION_SCHEMA = {
    "type": "object",
    "properties": {
        "defects": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "rule_id": {"type": "string"},
                    "severity": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                    },
                    "evidence_edu_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 2,
                        "description": "MUST cite ≥2 EDUs from different sections.",
                    },
                    "section": {
                        "type": "string",
                        "enum": [
                            "Abstract",
                            "Introduction",
                            "Method",
                            "Experiment",
                            "Results",
                            "Discussion",
                            "Conclusion",
                            "Other",
                        ],
                    },
                    "description": {"type": "string"},
                    "suggestion": {"type": "string"},
                    "confidence": {
                        "type": "number",
                        "minimum": 0.0,
                        "maximum": 1.0,
                    },
                },
                "required": [
                    "rule_id",
                    "severity",
                    "evidence_edu_ids",
                    "section",
                    "description",
                    "suggestion",
                    "confidence",
                ],
            },
        }
    },
    "required": ["defects"],
}


def cross_section_pass(
    paper_id: str,
    paper_title: str,
    edus: list[EDU],
    rule_ids: list[str] | None = None,
) -> tuple[list[Defect], RuleRunMeta]:
    """Run one Opus 1M call over the whole paper, focused on cross-section rules.

    Returns ([defects], meta). Returns ([], meta with defect_count=0) gracefully
    when there are no EDUs or no matching rules.
    """
    rule_ids = rule_ids or CROSS_SECTION_RULES
    rules_dict = {r["id"]: r for r in load_rules()}
    selected = [rules_dict[rid] for rid in rule_ids if rid in rules_dict]
    meta = RuleRunMeta(
        rule_id="cross_section",
        examples_used=0,
        candidate_count=1 if (selected and edus) else 0,
        defect_count=0,
    )
    if not selected or not edus:
        return [], meta

    edu_id_set = {e.id for e in edus}

    # Group EDUs by section in canonical order.
    by_section: dict[str, list[EDU]] = {}
    for e in edus:
        by_section.setdefault(e.section, []).append(e)
    dump: list[str] = [f"# Paper: {paper_title}"]
    for section in SECTION_ORDER:
        items = sorted(by_section.get(section, []), key=lambda e: e.order)
        if not items:
            continue
        dump.append(f"\n## {section}")
        for e in items:
            text = (e.text or "").strip().replace("\n", " ")
            dump.append(f"[EDU:{e.id}] (p.{e.page}) {text}")
    user_content = "\n".join(dump)[:400_000]

    rules_block = "\n".join(
        f"- {r['id']} ({r['name']}): {r['description']}" for r in selected
    )

    # Cross-section pass needs long context. Default model is gpt-4.1 (1M context),
    # which covers any normal thesis. Override via OPENAI_MODEL_CROSS_SECTION if the
    # lab key only has access to GPT-4o (128K) — papers >100K tokens may then truncate.
    # Setting ENABLE_CROSS_SECTION_PASS=0 in env skips this stage entirely.
    model = model_cross_section()
    out = call_with_tool(
        model=model,
        system=load_prompt("cross_section").format(rules_block=rules_block),
        user_content=user_content,
        tool_name="emit_cross_section_defects",
        tool_description="Emit cross-section defects for the listed rules.",
        tool_input_schema=CROSS_SECTION_SCHEMA,
        paper_id=paper_id,
        stage="cross_section_pass",
    )

    defects: list[Defect] = []
    for v in out.get("defects", []):
        rid = v.get("rule_id")
        rule = rules_dict.get(rid)
        if rule is None or rid not in rule_ids:
            continue
        ev_ids = [eid for eid in v.get("evidence_edu_ids", []) if eid in edu_id_set]
        if len(ev_ids) < 2:
            # The schema requires ≥2 evidence EDUs across sections; skip if not.
            continue
        defects.append(
            Defect(
                id=f"defect:{uuid.uuid4().hex[:8]}",
                rule_id=rid,
                defect_type=f"{rule['defect_label']}（跨章節）",
                severity=Severity(v.get("severity", "medium")),
                section=v.get("section", "Other"),
                evidence_edu_ids=ev_ids,
                description=v["description"],
                suggestion=v["suggestion"],
                confidence=_clamp_confidence(v.get("confidence")),
            )
        )
    meta.defect_count = len(defects)
    return defects, meta
