"""Load 13 REL rules and run them against a Paper KG to detect defects."""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import yaml

from .kg import run_cypher
from .llm import call_with_tool, model_heavy
from .schemas import Defect, Severity

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
                        "description": "Why it violates the rule, in 繁體中文.",
                    },
                    "suggestion": {
                        "type": "string",
                        "description": "Concrete fix in 繁體中文.",
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
                ],
            },
        }
    },
    "required": ["verdicts"],
}


CHECKER_SYSTEM_TEMPLATE = """You are a rigorous thesis reviewer. You will be given:
1) ONE rule from a 13-rule MECE-collapsed checklist (志祥學長 lab convention).
2) A list of CANDIDATE subgraphs from the paper that the Cypher query flagged.

For each candidate, decide whether it actually violates the rule. Be conservative:
- Only flag clear violations.
- Cite the specific EDU ids that evidence the violation.
- Severity: high = breaks core argument; medium = weakens; low = stylistic.
- Write description and suggestion in 繁體中文.

Rule:
  id: {rule_id}
  name: {rule_name}
  description: {rule_description}
"""


def check_rule(
    rule: dict[str, Any], paper_id: str, paper_title: str = ""
) -> list[Defect]:
    candidates = run_cypher(rule["candidate_query"], pid=paper_id)
    if not candidates:
        return []

    payload = {
        "paper_id": paper_id,
        "paper_title": paper_title,
        "candidates": [{"index": i, **c} for i, c in enumerate(candidates)],
    }

    out = call_with_tool(
        model=model_heavy(),
        system=CHECKER_SYSTEM_TEMPLATE.format(
            rule_id=rule["id"],
            rule_name=rule["name"],
            rule_description=rule["description"],
        ),
        user_content=json.dumps(payload, ensure_ascii=False, default=str)[:120_000],
        tool_name="emit_verdicts",
        tool_description="Emit per-candidate verdicts on this rule.",
        tool_input_schema=VERDICT_SCHEMA,
    )

    defects: list[Defect] = []
    for v in out.get("verdicts", []):
        if not v.get("violates"):
            continue
        defects.append(
            Defect(
                id=f"defect:{uuid.uuid4().hex[:8]}",
                rule_id=rule["id"],
                defect_type=rule["defect_label"],
                severity=Severity(v["severity"]),
                section=v["section"],
                evidence_edu_ids=v.get("evidence_edu_ids", []),
                description=v["description"],
                suggestion=v["suggestion"],
            )
        )
    return defects


def check_all_rules(paper_id: str, paper_title: str = "") -> list[Defect]:
    defects: list[Defect] = []
    for rule in load_rules():
        defects.extend(check_rule(rule, paper_id, paper_title))
    return defects
