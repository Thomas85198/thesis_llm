"""Tests for editor-mode AI rewrite (the highlight → rewrite menu)."""
from __future__ import annotations

import json

from app import llm, rewrite


def _data(events: list[str]) -> list[str]:
    out = []
    for e in events:
        body = e.removeprefix("data: ").strip()
        if body == "[DONE]":
            continue
        out.append(json.loads(body)["t"])
    return out


# ---------- instruction resolution ----------

def test_resolve_instruction_maps_preset():
    assert rewrite.resolve_instruction("paraphrase") == rewrite.PRESETS["paraphrase"]
    assert rewrite.resolve_instruction("  simplify ") == rewrite.PRESETS["simplify"]


def test_resolve_instruction_passes_custom_through():
    custom = "Rewrite this as a haiku"
    assert rewrite.resolve_instruction(custom) == custom


def test_build_system_includes_directive_and_language():
    system = rewrite._build_system("paraphrase", "zh-Hant")
    assert rewrite.PRESETS["paraphrase"] in system
    assert "Traditional Chinese" in system or "中文" in system  # {language} filled


# ---------- rate limit ----------

def test_rate_limit_blocks_after_ceiling(monkeypatch):
    monkeypatch.setattr(rewrite, "_rate_buckets", {})
    monkeypatch.setattr(rewrite, "RATE_LIMIT_PER_MIN", 2)
    assert rewrite.check_rate_limit("d")[0] is True
    assert rewrite.check_rate_limit("d")[0] is True
    allowed, wait = rewrite.check_rate_limit("d")
    assert allowed is False and wait >= 1


# ---------- sse_stream ----------

def _run(monkeypatch, tokens, **kw):
    def fake_stream(**_kwargs):
        yield from tokens

    monkeypatch.setattr(llm, "stream_completion", fake_stream)
    events = list(
        rewrite.sse_stream(
            doc_id="d", text="一些選取的文字。", instruction="paraphrase",
            locale="zh-Hant", **kw
        )
    )
    assert events[-1] == "data: [DONE]\n\n"  # always a clean terminator
    return _data(events)


def test_stream_emits_tokens_then_done(monkeypatch):
    assert _run(monkeypatch, ["一些", "改寫後", "的文字。"]) == ["一些", "改寫後", "的文字。"]


def test_stream_surfaces_llm_error(monkeypatch):
    def boom(**_kwargs):
        raise RuntimeError("quota exhausted")
        yield  # pragma: no cover — make it a generator

    monkeypatch.setattr(llm, "stream_completion", boom)
    events = list(
        rewrite.sse_stream(
            doc_id="d", text="x", instruction="simplify", locale="zh-Hant"
        )
    )
    assert any("error" in e for e in events)
    assert events[-1] == "data: [DONE]\n\n"
