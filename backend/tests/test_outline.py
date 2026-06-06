"""Tests for editor-mode outline generation (topic → heading tree)."""
from __future__ import annotations

from app import llm, outline


# ---------- _clean ----------

def test_clean_clamps_level_and_drops_blanks():
    raw = [
        {"level": 1, "text": "Introduction"},
        {"level": 9, "text": "Too deep"},      # clamped to 3
        {"level": 0, "text": "Too shallow"},   # clamped to 1
        {"level": 2, "text": "   "},            # blank → dropped
        {"level": "x", "text": "Bad level"},   # non-int → 1
    ]
    out = outline._clean(raw)
    assert out == [
        {"level": 1, "text": "Introduction"},
        {"level": 3, "text": "Too deep"},
        {"level": 1, "text": "Too shallow"},
        {"level": 1, "text": "Bad level"},
    ]


def test_clean_caps_count(monkeypatch):
    monkeypatch.setattr(outline, "MAX_HEADINGS", 3)
    raw = [{"level": 1, "text": f"H{i}"} for i in range(10)]
    assert len(outline._clean(raw)) == 3


# ---------- generate ----------

def test_generate_empty_topic_skips_call(monkeypatch):
    called = False

    def spy(**_kwargs):
        nonlocal called
        called = True
        return {"headings": []}

    monkeypatch.setattr(llm, "call_with_tool", spy)
    assert outline.generate("   ", "d", "zh-Hant") == []
    assert called is False


def test_generate_returns_cleaned_headings(monkeypatch):
    def fake(**kwargs):
        assert kwargs["stage"] == "outline"
        return {"headings": [{"level": 1, "text": "緒論"}, {"level": 7, "text": "方法"}]}

    monkeypatch.setattr(llm, "call_with_tool", fake)
    out = outline.generate("心流與學習動機", "d", "zh-Hant")
    assert out == [{"level": 1, "text": "緒論"}, {"level": 3, "text": "方法"}]


# ---------- rate limit ----------

def test_rate_limit_blocks_after_ceiling(monkeypatch):
    monkeypatch.setattr(outline, "_rate_buckets", {})
    monkeypatch.setattr(outline, "RATE_LIMIT_PER_MIN", 1)
    assert outline.check_rate_limit("d")[0] is True
    allowed, wait = outline.check_rate_limit("d")
    assert allowed is False and wait >= 1
