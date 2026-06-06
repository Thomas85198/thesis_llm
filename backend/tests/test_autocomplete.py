"""Tests for editor-mode autocomplete, focused on the repetition guard.

A degenerate document (the autocomplete loop, pasted boilerplate) can fill the
context window with one sentence repeated many times; the model then mirrors that
pattern. We defend on both sides: dedupe the context going in (_collapse_repeats)
and drop any echoed sentence coming out (sse_stream's buffered flush).
"""
from __future__ import annotations

import json

from app import autocomplete, llm


def _data(events: list[str]) -> list[str]:
    """Extract the 't' payloads from SSE event strings (skip [DONE])."""
    out = []
    for e in events:
        body = e.removeprefix("data: ").strip()
        if body == "[DONE]":
            continue
        out.append(json.loads(body)["t"])
    return out


# ---------- _collapse_repeats ----------

def test_collapse_repeats_drops_repeated_cjk_sentence():
    sent = "接著，本文將提出研究問題，說明研究方法，並依章節順序安排全文架構。"
    text = "前言。" + sent * 10 + "結語。"
    out = autocomplete._collapse_repeats(text)
    assert out.count(sent) == 1
    assert out == "前言。" + sent + "結語。"


def test_collapse_repeats_drops_repeated_latin_sentence():
    text = "Flow is a state. " * 5 + "The end."
    assert autocomplete._collapse_repeats(text) == "Flow is a state. The end."


def test_collapse_repeats_preserves_trailing_fragment():
    # The partial sentence at the cursor (no terminator) must survive even if it
    # duplicates an earlier sentence — that is where completion happens.
    text = "心流。心流。心流"  # two full + one fragment, all identical
    out = autocomplete._collapse_repeats(text)
    assert out == "心流。心流"  # one full kept + the trailing fragment


def test_collapse_repeats_noop_on_distinct_prose():
    text = "第一句。第二句。第三句。"
    assert autocomplete._collapse_repeats(text) == text


# ---------- sse_stream output guard ----------

def _run_stream(monkeypatch, tokens, text_before):
    def fake_stream(**_kwargs):
        yield from tokens

    monkeypatch.setattr(llm, "stream_completion", fake_stream)
    events = list(
        autocomplete.sse_stream(
            doc_id="d", text_before=text_before, title="t", outline="", locale="zh-Hant"
        )
    )
    assert events[-1] == "data: [DONE]\n\n"  # always a clean terminator
    return _data(events)


def test_stream_suppresses_sentence_that_echoes_context(monkeypatch):
    ctx = "前言。接著，本文將提出研究問題。"
    # Model immediately loops a sentence that already exists in the context.
    out = _run_stream(monkeypatch, ["接著，本文", "將提出研究問題。", "新句。"], ctx)
    assert out == []  # cut at the first echoed sentence, nothing shown


def test_stream_passes_through_novel_sentences(monkeypatch):
    out = _run_stream(
        monkeypatch,
        ["並進一步", "分析其應用與限制。", "本文採用質性研究方法。"],
        "本研究旨在探討心流。",
    )
    assert out == ["並進一步分析其應用與限制。", "本文採用質性研究方法。"]


def test_stream_emits_trailing_partial(monkeypatch):
    # No terminator at the end → the partial still flushes (one suggestion).
    out = _run_stream(monkeypatch, ["並進一步分析其"], "本研究旨在探討心流。")
    assert out == ["並進一步分析其"]


def test_stream_surfaces_llm_error(monkeypatch):
    def boom(**_kwargs):
        raise RuntimeError("quota exhausted")
        yield  # pragma: no cover — make it a generator

    monkeypatch.setattr(llm, "stream_completion", boom)
    events = list(
        autocomplete.sse_stream(
            doc_id="d", text_before="x。", title="t", outline="", locale="zh-Hant"
        )
    )
    assert any("error" in e for e in events)
    assert events[-1] == "data: [DONE]\n\n"
