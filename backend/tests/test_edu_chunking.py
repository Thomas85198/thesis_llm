"""Unit tests for long-section EDU chunking (the appendix-truncation fix).

A section that swallows references + appendices can exceed call_with_tool's
output-token cap; extract_edus now splits the section spans into char-bounded
chunks, and a chunk whose output still truncates is recursively halved. We
mock call_with_tool so no real LLM call happens.
"""
from __future__ import annotations

import app.pipeline as pipeline
from app.llm import LLMOutputTruncatedError
from app.pipeline import Span, _chunk_spans_by_chars, extract_edus


def _spans(*texts: str) -> list[Span]:
    out, offset = [], 0
    for t in texts:
        out.append(
            Span(
                page=0,
                bbox=(0, 0, 10, 10),
                text=t,
                char_start=offset,
                char_end=offset + len(t),
            )
        )
        offset += len(t)
    return out


def test_chunk_spans_packs_greedily():
    spans = _spans("a" * 40, "b" * 40, "c" * 40, "d" * 40)
    chunks = _chunk_spans_by_chars(spans, max_chars=100)
    assert [len(c) for c in chunks] == [2, 2]
    # Reading order is preserved across chunks.
    assert [s.text[0] for c in chunks for s in c] == ["a", "b", "c", "d"]


def test_chunk_spans_oversized_span_is_own_chunk():
    spans = _spans("a" * 10, "x" * 500, "b" * 10)
    chunks = _chunk_spans_by_chars(spans, max_chars=100)
    # The oversized span can't be split below span granularity — it becomes
    # its own chunk and never drags neighbours over budget.
    assert [len(c) for c in chunks] == [1, 1, 1]
    assert chunks[1][0].text[0] == "x"


def test_extract_edus_short_section_single_call(monkeypatch):
    calls: list[str] = []

    def fake_call(*, user_content, **kwargs):
        calls.append(user_content)
        return {"edus": [{"text": "one"}, {"text": "two"}]}

    monkeypatch.setattr(pipeline, "call_with_tool", fake_call)
    edus = extract_edus("Method", _spans("short section text. "), "p1")
    assert len(calls) == 1
    assert [e.text for e in edus] == ["one", "two"]
    assert [e.order for e in edus] == [0, 1]


def test_extract_edus_long_section_chunks_and_keeps_order(monkeypatch):
    monkeypatch.setenv("EDU_CHUNK_MAX_CHARS", "1000")
    counter = {"n": 0}

    def fake_call(*, user_content, **kwargs):
        counter["n"] += 1
        return {"edus": [{"text": f"edu-{counter['n']}"}]}

    monkeypatch.setattr(pipeline, "call_with_tool", fake_call)
    # 4 spans of 600 chars → chunks of 1 span each under the 1000-char budget.
    spans = _spans(*["word " * 120 for _ in range(4)])
    edus = extract_edus("Conclusion", spans, "p1")
    assert counter["n"] == 4
    assert [e.text for e in edus] == ["edu-1", "edu-2", "edu-3", "edu-4"]
    assert [e.order for e in edus] == [0, 1, 2, 3]
    # ids stay section-global, not per-chunk.
    assert edus[3].id == "p1:Conclusion:edu:3"


def test_extract_edus_truncated_chunk_recursively_halves(monkeypatch):
    """A chunk whose output truncates is split in half until it fits."""
    monkeypatch.setenv("EDU_CHUNK_MAX_CHARS", "10000")
    calls: list[int] = []

    def fake_call(*, user_content, **kwargs):
        calls.append(len(user_content))
        # Anything holding more than 2 of the 600-char spans still truncates.
        if len(user_content) > 1500:
            raise LLMOutputTruncatedError("cap hit")
        return {"edus": [{"text": "ok"}]}

    monkeypatch.setattr(pipeline, "call_with_tool", fake_call)
    spans = _spans(*["word " * 120 for _ in range(4)])  # one 2400-char chunk
    edus = extract_edus("Conclusion", spans, "p1")
    # 1 failed full call + 2 successful half calls (1200 chars each).
    assert len(calls) == 3
    assert [e.text for e in edus] == ["ok", "ok"]


def test_extract_edus_single_span_truncation_reraises(monkeypatch):
    def fake_call(**kwargs):
        raise LLMOutputTruncatedError("cap hit")

    monkeypatch.setattr(pipeline, "call_with_tool", fake_call)
    try:
        extract_edus("Other", _spans("x" * 50), "p1")
    except LLMOutputTruncatedError:
        pass
    else:
        raise AssertionError("expected LLMOutputTruncatedError to propagate")
