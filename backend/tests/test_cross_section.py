"""Tests for cross_section_pass output cap + graceful truncation degrade."""

from __future__ import annotations

from app import rules
from app.llm import LLMOutputTruncatedError
from app.schemas import EDU


def _edu(eid, text, section):
    return EDU(id=eid, text=text, section=section, order=0)


def _edus():
    return [
        _edu("e1", "摘要宣稱本方法最佳。", "Abstract"),
        _edu("e2", "結論卻未支持該宣稱。", "Conclusion"),
    ]


def test_truncation_degrades_gracefully(monkeypatch):
    """A runaway single-candidate call that hits the cap must not kill analysis."""

    def boom(*a, **k):
        raise LLMOutputTruncatedError("output hit cap")

    monkeypatch.setattr(rules, "call_with_tool", boom)

    defects, meta = rules.cross_section_pass("p", "Title", _edus(), rule_ids=["REL-12"])

    assert defects == []
    assert meta.defect_count == 0


def test_parses_valid_defect_and_passes_cap(monkeypatch):
    """Normal path still parses a valid cross-section defect; output cap is wired."""
    captured = {}
    out = {
        "defects": [
            {
                "rule_id": "REL-12",
                "severity": "high",
                "evidence_edu_ids": ["e1", "e2"],
                "section": "Conclusion",
                "description": "摘要與結論不一致。",
                "suggestion": "讓結論回應摘要的宣稱。",
                "confidence": 0.9,
            }
        ]
    }

    def cap(*a, **k):
        captured.update(k)
        return out

    monkeypatch.setattr(rules, "call_with_tool", cap)

    defects, meta = rules.cross_section_pass("p", "Title", _edus(), rule_ids=["REL-12"])

    assert len(defects) == 1
    assert defects[0].rule_id == "REL-12"
    assert meta.defect_count == 1
    assert captured["max_tokens"] == 8000
