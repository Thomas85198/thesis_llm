"""Load 13 REL rules and run them against a Paper KG to detect defects."""

from __future__ import annotations

import json
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import yaml

from .i18n import LANG_NAME, PRIMARY_LOCALE, SUPPORTED_LOCALES
from .kg import resolve_evidence_to_edus, run_cypher
from .llm import (
    LLMOutputTruncatedError,
    call_with_tool,
    llm_max_workers,
    model_cross_section,
    model_heavy,
    model_light,
)
from .prompts import load_prompt
from .schemas import EDU, Defect, RuleRunMeta, Severity

RULES_FILE = Path(__file__).parent.parent / "rules.yaml"


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
                        "description": (
                            "Why it violates the rule, in the language requested "
                            "by the system prompt. Only fill when violates=true."
                        ),
                    },
                    "suggestion": {
                        "type": "string",
                        "description": (
                            "Concrete fix, in the language requested by the system "
                            "prompt. Only fill when violates=true."
                        ),
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
                # Only index + violates are always required. The detail fields
                # (severity/section/evidence/description/suggestion/confidence)
                # are filled ONLY for violations — non-violations are discarded
                # in check_rule, so forcing the model to write 繁體中文 prose for
                # every non-violating candidate was pure token waste (e.g. REL-06
                # with 62 candidates but 5 violations emitted ~7k output tokens).
                "required": [
                    "candidate_index",
                    "violates",
                ],
            },
        }
    },
    "required": ["verdicts"],
}


def check_rule(
    rule: dict[str, Any], paper_id: str, paper_title: str = ""
) -> tuple[list[Defect], RuleRunMeta]:
    candidates = run_cypher(rule["candidate_query"], pid=paper_id)

    meta = RuleRunMeta(
        rule_id=rule["id"],
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
            language=LANG_NAME[PRIMARY_LOCALE],
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
        # A violation with no description is useless to the reviewer (and now
        # that the detail fields are schema-optional, a misbehaving model could
        # omit them). Skip rather than crash the whole rule.
        description = v.get("description")
        if not description:
            continue
        # Candidate subgraphs are FRU-based, so the LLM frequently cites FRU
        # node ids here — those don't resolve to a PDF location. Expand them to
        # the concrete EDU ids they cover so "在 PDF 中查看" always works.
        evidence_edu_ids = resolve_evidence_to_edus(v.get("evidence_edu_ids", []))
        try:
            severity = Severity(v.get("severity", "medium"))
        except ValueError:
            severity = Severity("medium")
        defects.append(
            Defect(
                id=f"defect:{uuid.uuid4().hex[:8]}",
                rule_id=rule["id"],
                defect_type=rule["defect_label"],
                severity=severity,
                section=v.get("section", "Other"),
                evidence_edu_ids=evidence_edu_ids,
                description={PRIMARY_LOCALE: description},
                suggestion={PRIMARY_LOCALE: v.get("suggestion", "")},
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
    # REL-04 / REL-12 judge whole-paper structure — their candidate_query exposes
    # no EDU ids, so per-section verdicts can never cite a PDF location (the
    # "在 PDF 中查看" button would go nowhere). The cross-section pass handles
    # both with full-paper context + forced evidence (always locatable, higher
    # confidence), so when it's enabled (default) run them ONLY there. If
    # cross-section is disabled, fall back to per-section so they still run.
    skip = (
        {"REL-04", "REL-12"}
        if os.getenv("ENABLE_CROSS_SECTION_PASS", "1") == "1"
        else set()
    )
    rules = [r for r in load_rules() if r["id"] not in skip]
    defects: list[Defect] = []
    metas: list[RuleRunMeta] = []

    # The remaining REL rules are independent (each runs its own Cypher + one LLM
    # judgment), so fan them out across a bounded thread pool — this is the
    # single biggest latency win in the pipeline. pool.map preserves rule
    # order, so metas/defects stay in a stable, reproducible order.
    if rules:
        with ThreadPoolExecutor(max_workers=llm_max_workers()) as pool:
            results = pool.map(lambda r: check_rule(r, paper_id, paper_title), rules)
            for rule_defects, meta in results:
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
    # A single candidate (e.g. REL-12 abstract-vs-conclusion) over the whole-paper
    # dump occasionally makes the model run away and emit thousands of tokens. Cap
    # output well above the ~561-token norm to stop the blow-up, and degrade
    # gracefully on truncation: a missed cross-section pass beats killing the whole
    # analysis (consistent with the no-rule/no-EDU early returns above).
    try:
        out = call_with_tool(
            model=model,
            system=load_prompt("cross_section").format(
                rules_block=rules_block,
                language=LANG_NAME[PRIMARY_LOCALE],
            ),
            user_content=user_content,
            tool_name="emit_cross_section_defects",
            tool_description="Emit cross-section defects for the listed rules.",
            tool_input_schema=CROSS_SECTION_SCHEMA,
            max_tokens=8000,
            paper_id=paper_id,
            stage="cross_section_pass",
        )
    except LLMOutputTruncatedError as exc:
        print(
            f"[rules] cross_section_pass output truncated for paper={paper_id} — skipping: {exc}"
        )
        return [], meta

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
                description={PRIMARY_LOCALE: v["description"]},
                suggestion={PRIMARY_LOCALE: v["suggestion"]},
                confidence=_clamp_confidence(v.get("confidence")),
            )
        )
    meta.defect_count = len(defects)
    return defects, meta


# ---------- Translation pass (fill non-primary locales) ----------
# Defects are generated in PRIMARY_LOCALE; this fills every other supported
# locale by translating description+suggestion in one batched call per locale
# (cheap model). Stored as a {locale: text} map so the UI switches instantly.
# Adding a language never changes this code — it iterates SUPPORTED_LOCALES.

TRANSLATE_SCHEMA = {
    "type": "object",
    "properties": {
        "translations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "description": {"type": "string"},
                    "suggestion": {"type": "string"},
                },
                "required": ["index", "description", "suggestion"],
            },
        }
    },
    "required": ["translations"],
}


def localize_defects(defects: list[Defect], paper_id: str) -> None:
    """In place, fill every non-primary supported locale on each defect's
    description/suggestion by translating the PRIMARY_LOCALE text.

    Best-effort: a failed locale leaves that locale absent (the UI then falls
    back to PRIMARY via i18n.pick / pickLocalized).
    """
    targets = [loc for loc in SUPPORTED_LOCALES if loc != PRIMARY_LOCALE]
    if not defects or not targets:
        return

    items = [
        {
            "index": i,
            "description": d.description.get(PRIMARY_LOCALE, ""),
            "suggestion": d.suggestion.get(PRIMARY_LOCALE, ""),
        }
        for i, d in enumerate(defects)
    ]
    payload = json.dumps(items, ensure_ascii=False)[:120_000]

    for target in targets:
        try:
            out = call_with_tool(
                model=model_light(),
                system=load_prompt("translate").format(language=LANG_NAME[target]),
                user_content=payload,
                tool_name="emit_translations",
                tool_description="Emit the translated description+suggestion per index.",
                tool_input_schema=TRANSLATE_SCHEMA,
                paper_id=paper_id,
                stage=f"translate:{target}",
            )
        except Exception as exc:  # noqa: BLE001 — translation is best-effort
            print(f"[translate] locale={target} failed: {exc!r}")
            continue
        for t in out.get("translations", []):
            idx = t.get("index")
            if not isinstance(idx, int) or not (0 <= idx < len(defects)):
                continue
            if t.get("description"):
                defects[idx].description[target] = t["description"]
            if t.get("suggestion"):
                defects[idx].suggestion[target] = t["suggestion"]
