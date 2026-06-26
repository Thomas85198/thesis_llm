"""三個 ablation arm 的執行：對同一篇論文各產一組「缺陷 + 建議」。

- Arm A（baseline）：全文直接丟 LLM。
- Arm C（中間項）：用拆解後的 EDU/FRU/ER 丟 LLM，但不套 13 REL 規則。
- Arm B（本方法）：現有完整 pipeline 的 defects（cache 讀 result_json，fresh 重跑）。

三 arm 統一輸出格式（list[Finding]）：每筆 {location, issue_type, severity,
description, suggestion}，讓 judge 能盲評、互比。受測 LLM 一律走 app.llm（OpenAI）。
"""

from __future__ import annotations

from typing import Any

from app import kg, llm, pipeline, rules

from . import corpus
from .corpus import CorpusItem

# Arm A/C 共用的開放式缺陷輸出 schema（不洩漏 13 REL 規則清單，維持與 B 的對照公平）。
FINDING_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "defects": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "location": {"type": "string"},
                    "issue_type": {"type": "string"},
                    "severity": {"type": "string", "enum": ["high", "medium", "low"]},
                    "description": {"type": "string"},
                    "suggestion": {"type": "string"},
                },
                "required": [
                    "location",
                    "issue_type",
                    "severity",
                    "description",
                    "suggestion",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["defects"],
    "additionalProperties": False,
}


def _pick_zh(localized: dict[str, str] | str) -> str:
    """Defect 的 description/suggestion 是 locale map；取繁中、否則第一個值。"""
    if isinstance(localized, str):
        return localized
    if not localized:
        return ""
    return localized.get("zh-Hant") or next(iter(localized.values()), "")


def materialize(item: CorpusItem, fresh: bool) -> tuple[dict, list[dict]]:
    """回傳 (graph_dict, arm_b_defects)。

    cache：直接讀 result_json（graph + 完整 pipeline 的 defects）。
    fresh：從 PDF 重跑 build_paper_graph + 13 REL 規則（需 neo4j、有 PDF 的篇才行）。
    """
    if not fresh:
        r = corpus.load_result(item)
        return r["graph"], r.get("defects", [])

    if not item.can_fresh:
        raise ValueError(f"{item.paper_id} 無 PDF，無法 fresh 重跑")
    raw = corpus.pdf_bytes(item)
    spans = pipeline.extract_spans_from_bytes(raw, item.filename or "paper.pdf")
    title = (
        item.title or pipeline.detect_paper_title(spans, item.paper_id) or item.filename
    )
    graph = pipeline.build_paper_graph(spans, title, item.paper_id)
    kg.write_graph(graph)
    defects, _ = rules.check_all_rules(item.paper_id, title)
    cs_defects, _ = rules.cross_section_pass(item.paper_id, title, graph.edus)
    defects.extend(cs_defects)
    rules.localize_defects(defects, item.paper_id)
    return graph.model_dump(), [d.model_dump() for d in defects]


def _structure_dump(graph: dict) -> str:
    """把拆解結果（EDU/FRU/ER）攤平成 Arm C 的輸入文字。"""
    edus = graph.get("edus", [])
    edu_text = {e["id"]: e.get("text", "") for e in edus}
    lines = ["# EDUs（依文件順序，標注章節）"]
    for e in edus:
        lines.append(f"[{e.get('section', '?')}] {e.get('text', '')}")
    lines.append("\n# Functional units（修辭功能）")
    for f in graph.get("fru_nodes", []):
        covered = " ".join(edu_text.get(i, "") for i in f.get("edu_ids", []))
        lines.append(f"{f.get('function', '?')}: {f.get('summary') or covered[:120]}")
    lines.append("\n# Entity relations（實體關係三元組）")
    ent = {en["id"]: en.get("name", "?") for en in graph.get("entities", [])}
    for t in graph.get("er_triples", []):
        s = ent.get(t.get("source_entity_id"), "?")
        o = ent.get(t.get("target_entity_id"), "?")
        lines.append(f"{s} --{t.get('predicate', '?')}--> {o}")
    return "\n".join(lines)


def _llm_findings(
    system_prompt: str, user_content: str, paper_id: str, stage: str
) -> list[dict]:
    out = llm.call_with_tool(
        model=llm.model_heavy(),
        system=system_prompt,
        user_content=user_content,
        tool_name="emit_defects",
        tool_description="Emit the writing defects you found, with suggestions.",
        tool_input_schema=FINDING_SCHEMA,
        paper_id=paper_id,
        stage=stage,
    )
    return out.get("defects", [])


def run_arm_a(item: CorpusItem, graph: dict) -> list[dict]:
    """全文直接丟 LLM。"""
    from app.prompts import load_prompt

    text = corpus.full_text(graph)
    return _llm_findings(
        load_prompt("ablation_holistic"), text, item.paper_id, "ablation:arm_a"
    )


def run_arm_c(item: CorpusItem, graph: dict) -> list[dict]:
    """拆解後丟 LLM，不套規則。"""
    from app.prompts import load_prompt

    dump = _structure_dump(graph)
    return _llm_findings(
        load_prompt("ablation_structure"), dump, item.paper_id, "ablation:arm_c"
    )


def run_arm_b(graph: dict, b_defects: list[dict]) -> list[dict]:
    """本方法：把完整 pipeline 的 Defect 正規化成統一格式。"""
    edu_text = {e["id"]: e.get("text", "") for e in graph.get("edus", [])}
    findings: list[dict] = []
    for d in b_defects:
        ev = " / ".join(
            edu_text.get(eid, "")
            for eid in d.get("evidence_edu_ids", [])
            if edu_text.get(eid)
        )
        section = d.get("section", "")
        findings.append(
            {
                "location": f"{section}：{ev}".strip("：") if (section or ev) else "",
                "issue_type": d.get("defect_type") or d.get("rule_id", ""),
                "severity": d.get("severity", ""),
                "description": _pick_zh(d.get("description", {})),
                "suggestion": _pick_zh(d.get("suggestion", {})),
            }
        )
    return findings


def run_all_arms(
    item: CorpusItem, *, fresh: bool = False, arms: tuple[str, ...] = ("A", "C", "B")
) -> dict[str, list[dict]]:
    """跑指定 arm，回傳 {arm: findings}。A/C 各 1 次 LLM 呼叫，B 用現成/重跑結果。"""
    graph, b_defects = materialize(item, fresh)
    result: dict[str, list[dict]] = {}
    if "A" in arms:
        result["A"] = run_arm_a(item, graph)
    if "C" in arms:
        result["C"] = run_arm_c(item, graph)
    if "B" in arms:
        result["B"] = run_arm_b(graph, b_defects)
    return result
