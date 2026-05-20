"""Unit tests for the native→OCR routing in `_extract_pdf_spans`.

We mock both the native extractor and the OCR extractor so the decision logic
is tested in isolation — no real PDF, no tesseract, milliseconds to run.
"""
from __future__ import annotations

import app.pipeline as pipeline
from app.pipeline import Span


def _span(text: str) -> Span:
    return Span(page=0, bbox=(0, 0, 0, 0), text=text, char_start=0, char_end=len(text))


# Enough cipher-punctuation to clear the garble threshold (see GARBLED_SAMPLE).
GARBLED = [_span("*?Ti2` e `>v#`B/ *Sh `v2bBM `2`MFBM; `M/ `7`K2rQ`F " * 8)]
CLEAN = [_span("This is a perfectly readable English abstract sentence. " * 8)]
OCR_RESULT = [_span("Recovered readable text from OCR.\n")]


def test_garbled_native_triggers_ocr(monkeypatch):
    calls = {"ocr": 0, "fallback": 0}

    monkeypatch.setattr(pipeline, "_extract_pdf_spans_native", lambda data: GARBLED)

    def fake_ocr(data):
        calls["ocr"] += 1
        return OCR_RESULT

    monkeypatch.setattr(pipeline, "_extract_pdf_spans_ocr", fake_ocr)

    result = pipeline._extract_pdf_spans(
        b"%PDF-fake", on_ocr_fallback=lambda: calls.__setitem__("fallback", calls["fallback"] + 1)
    )

    assert result is OCR_RESULT          # OCR output is used
    assert calls["ocr"] == 1             # OCR actually ran
    assert calls["fallback"] == 1        # user got the "switching to OCR" notice


def test_clean_native_skips_ocr(monkeypatch):
    calls = {"ocr": 0, "fallback": 0}

    monkeypatch.setattr(pipeline, "_extract_pdf_spans_native", lambda data: CLEAN)
    monkeypatch.setattr(
        pipeline, "_extract_pdf_spans_ocr",
        lambda data: calls.__setitem__("ocr", calls["ocr"] + 1),
    )

    result = pipeline._extract_pdf_spans(
        b"%PDF-fake", on_ocr_fallback=lambda: calls.__setitem__("fallback", calls["fallback"] + 1)
    )

    assert result is CLEAN               # native output kept
    assert calls["ocr"] == 0             # OCR never invoked
    assert calls["fallback"] == 0        # no notice fired


def test_ocr_empty_falls_back_to_native(monkeypatch):
    # If OCR yields nothing usable, keep the (garbled) native spans rather than
    # returning an empty document — downstream then surfaces a clear error.
    monkeypatch.setattr(pipeline, "_extract_pdf_spans_native", lambda data: GARBLED)
    monkeypatch.setattr(pipeline, "_extract_pdf_spans_ocr", lambda data: [])

    result = pipeline._extract_pdf_spans(b"%PDF-fake")

    assert result is GARBLED
