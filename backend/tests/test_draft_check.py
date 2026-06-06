"""Tests for defect-check-on-draft (the Thesis Critic wired to editor text)."""
from __future__ import annotations

from app import draft_check, kg, pipeline, rules
from app.schemas import Defect, EDU, PaperGraph, Severity


def _edu(i, text):
    return EDU(id=i, text=text, section="Other", order=0)


def _defect(rule_id, edu_ids):
    return Defect(
        id=f"d:{rule_id}", rule_id=rule_id, defect_type="X", severity=Severity.MEDIUM,
        section="Other", evidence_edu_ids=edu_ids,
        description={"zh-Hant": "缺陷說明", "en": "defect"},
        suggestion={"zh-Hant": "建議", "en": "fix"}, confidence=0.8,
    )


def _wire(monkeypatch, defects):
    graph = PaperGraph(paper_id="p", edus=[_edu("e1", "這是一個主張。"), _edu("e2", "另一句。")])
    monkeypatch.setattr(pipeline, "extract_spans_from_bytes", lambda *a, **k: ["span"])
    monkeypatch.setattr(pipeline, "build_paper_graph", lambda *a, **k: graph)
    monkeypatch.setattr(kg, "write_graph", lambda g: None)
    cleared = {}
    monkeypatch.setattr(kg, "clear_paper", lambda pid: cleared.update({"id": pid}))
    monkeypatch.setattr(rules, "check_all_rules", lambda *a, **k: (defects, []))
    return cleared


def test_filters_to_single_section_and_resolves_evidence(monkeypatch):
    cleared = _wire(monkeypatch, [
        _defect("REL-01", ["e1"]),       # single-section → kept
        _defect("REL-04", ["e1"]),       # cross-section → dropped
        _defect("REL-09", ["e2", "x"]),  # kept; unknown edu id ignored
    ])
    out = draft_check.check_draft("一些草稿文字。", "doc", "zh-Hant")
    assert [d["rule_id"] for d in out] == ["REL-01", "REL-09"]
    assert out[0]["evidence"] == ["這是一個主張。"]
    assert out[0]["description"] == "缺陷說明"  # picked zh-Hant
    assert out[1]["evidence"] == ["另一句。"]
    assert cleared["id"].startswith("draft:")  # temp graph cleaned up


def test_empty_text_returns_empty_no_pipeline(monkeypatch):
    called = {"n": 0}
    monkeypatch.setattr(pipeline, "extract_spans_from_bytes", lambda *a, **k: called.update(n=called["n"] + 1) or [])
    assert draft_check.check_draft("   ", "doc", "zh-Hant") == []
    assert called["n"] == 0


def test_graph_cleared_even_on_rule_error(monkeypatch):
    cleared = _wire(monkeypatch, [])
    def boom(*a, **k):
        raise RuntimeError("neo4j down")
    monkeypatch.setattr(rules, "check_all_rules", boom)
    try:
        draft_check.check_draft("文字。", "doc", "zh-Hant")
    except RuntimeError:
        pass
    assert cleared.get("id", "").startswith("draft:")


def test_rate_limit_blocks_after_ceiling(monkeypatch):
    monkeypatch.setattr(draft_check, "_rate_buckets", {})
    monkeypatch.setattr(draft_check, "RATE_LIMIT_PER_MIN", 1)
    assert draft_check.check_rate_limit("d")[0] is True
    allowed, wait = draft_check.check_rate_limit("d")
    assert allowed is False and wait >= 1
