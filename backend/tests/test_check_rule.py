"""Tests for check_rule verdict parsing — the per-section rule engine's defensive
layer (docs/TODO.md E5: previously zero coverage on the core chain).

All LLM / Neo4j boundaries are mocked: run_cypher supplies candidates,
call_with_tool supplies verdicts, resolve_evidence_to_edus is identity.
"""

from __future__ import annotations

import pytest

from app import rules
from app.schemas import Severity


RULE = {
    "id": "REL-01",
    "name": "Claim-Evidence",
    "description": "每個主張都應該有證據。",
    "candidate_query": "MATCH (n) RETURN n  // unused in tests",
    "defect_label": "NakedClaim",
}


def _wire(monkeypatch, candidates, verdicts):
    calls = {"llm": 0}

    monkeypatch.setattr(rules, "run_cypher", lambda q, **kw: candidates)
    monkeypatch.setattr(rules, "resolve_evidence_to_edus", lambda ids: ids)

    def fake_llm(*a, **k):
        calls["llm"] += 1
        return {"verdicts": verdicts}

    monkeypatch.setattr(rules, "call_with_tool", fake_llm)
    return calls


def _verdict(**overrides):
    v = {
        "candidate_index": 0,
        "violates": True,
        "severity": "high",
        "section": "Method",
        "evidence_edu_ids": ["p:Method:edu:1"],
        "description": "主張缺乏證據。",
        "suggestion": "補上實驗數據。",
        "confidence": 0.8,
    }
    v.update(overrides)
    return v


def test_zero_candidates_skips_llm_entirely(monkeypatch):
    calls = _wire(monkeypatch, candidates=[], verdicts=[])

    defects, meta = rules.check_rule(RULE, "paper:x")

    assert defects == []
    assert meta.candidate_count == 0
    assert meta.defect_count == 0
    assert calls["llm"] == 0


def test_valid_violation_becomes_defect(monkeypatch):
    _wire(monkeypatch, [{"fru_id": "f1"}], [_verdict()])

    defects, meta = rules.check_rule(RULE, "paper:x")

    assert meta.candidate_count == 1
    assert meta.defect_count == 1
    d = defects[0]
    assert d.rule_id == "REL-01"
    assert d.defect_type == "NakedClaim"
    assert d.severity is Severity.HIGH
    assert d.section == "Method"
    assert d.evidence_edu_ids == ["p:Method:edu:1"]
    assert d.description == {rules.PRIMARY_LOCALE: "主張缺乏證據。"}
    assert d.confidence == 0.8


def test_non_violating_verdict_is_dropped(monkeypatch):
    _wire(monkeypatch, [{"fru_id": "f1"}], [_verdict(violates=False)])

    defects, meta = rules.check_rule(RULE, "paper:x")

    assert defects == []
    assert meta.defect_count == 0


def test_violation_without_description_is_skipped_not_crash(monkeypatch):
    _wire(
        monkeypatch,
        [{"fru_id": "f1"}],
        [_verdict(description=None), _verdict(description="有寫描述。")],
    )

    defects, _ = rules.check_rule(RULE, "paper:x")

    assert len(defects) == 1
    assert defects[0].description[rules.PRIMARY_LOCALE] == "有寫描述。"


def test_bogus_severity_falls_back_to_medium(monkeypatch):
    _wire(monkeypatch, [{"fru_id": "f1"}], [_verdict(severity="catastrophic")])

    defects, _ = rules.check_rule(RULE, "paper:x")

    assert defects[0].severity is Severity.MEDIUM


def test_missing_section_defaults_to_other(monkeypatch):
    v = _verdict()
    del v["section"]
    _wire(monkeypatch, [{"fru_id": "f1"}], [v])

    defects, _ = rules.check_rule(RULE, "paper:x")

    assert defects[0].section == "Other"


def test_evidence_ids_go_through_fru_to_edu_resolution(monkeypatch):
    _wire(monkeypatch, [{"fru_id": "f1"}], [_verdict(evidence_edu_ids=["p:fru:9"])])
    monkeypatch.setattr(
        rules, "resolve_evidence_to_edus", lambda ids: ["p:Method:edu:7"]
    )

    defects, _ = rules.check_rule(RULE, "paper:x")

    assert defects[0].evidence_edu_ids == ["p:Method:edu:7"]


@pytest.mark.parametrize(
    "raw, expected",
    [
        (0.5, 0.5),
        (1.7, 1.0),
        (-0.2, 0.0),
        ("0.9", 0.9),
        ("not-a-number", None),
        (None, None),
    ],
)
def test_confidence_is_clamped(monkeypatch, raw, expected):
    _wire(monkeypatch, [{"fru_id": "f1"}], [_verdict(confidence=raw)])

    defects, _ = rules.check_rule(RULE, "paper:x")

    assert defects[0].confidence == expected


def test_dump_capped_drops_whole_trailing_candidates(monkeypatch):
    """Payload over the char cap must shed whole candidates, never cut JSON
    mid-string (the old [:cap] slice fed the model broken JSON)."""
    import json

    monkeypatch.setattr(rules, "_PAYLOAD_CHAR_CAP", 400)
    payload = {
        "paper_id": "p",
        "candidates": [{"index": i, "text": "字" * 50} for i in range(10)],
    }

    text, dropped = rules._dump_capped(payload, "candidates")

    assert dropped > 0
    parsed = json.loads(text)  # still valid JSON
    assert len(parsed["candidates"]) == 10 - dropped
    # survivors are the leading candidates, untouched
    assert parsed["candidates"][0]["index"] == 0


def test_dump_capped_untouched_when_under_cap():
    import json

    payload = {"paper_id": "p", "candidates": [{"index": 0}]}

    text, dropped = rules._dump_capped(payload, "candidates")

    assert dropped == 0
    assert json.loads(text) == payload
