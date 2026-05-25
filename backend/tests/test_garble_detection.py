"""Unit tests for the PDF garble detector that drives the OCR fallback.

`_looks_garbled` already shipped one real bug (the original two-condition
threshold missed substitution-cipher garble because letters stay letters).
These tests pin the behaviour so that bug — and ones like it — can't come back.
No PDF fixtures, no network: we feed Spans built from raw strings.
"""
from __future__ import annotations

from app.pipeline import Span, _looks_garbled


def _spans(text: str) -> list[Span]:
    """Build line-level Spans the way native extraction would, from a string."""
    spans: list[Span] = []
    cursor = 0
    for line in text.splitlines():
        t = line + "\n"
        spans.append(Span(page=0, bbox=(0, 0, 0, 0), text=t,
                          char_start=cursor, char_end=cursor + len(t)))
        cursor += len(t)
    return spans


# The actual PyMuPDF output for NeuroSymbolicAI4Law2.pdf — a LaTeX PDF whose
# Type-3 fonts have no ToUnicode CMap, so glyph indices leak as a cipher.
# This is the exact regression case that motivated the OCR fallback.
GARBLED_SAMPLE = (
    "*?Ti2` e\n"
    ">v#`B/ *Sh \"v2bBM _2`MFBM; M/\n"
    "6BM2`@*J L2m`Q@avK#QHB+ 6mbBQM\n"
    "\"mBH/BM; QM i?2 M2m`Q@bvK#QHB+ 7`K2rQ`F 2bi#HBb?2/ BM *?Ti2` 8- i?Bb +?Ti2` 7m`@\n"
    "i?2` BMp2biB;i2b irQ +QKTH2K2Mi`v `2b2`+? /B`2+iBQMb, URV  \"v2bBM `2`MFBM; K2+?@\n"
    "MBbK +2Mi2`2/ QM *QM/BiBQMH S`Q##BHBiv h#H2b U*ShV- r?B+? T`QpB/2b [mMiB}#H2\n"
    "mM+2`iBMiv 2biBKi2b 7Q` H2;H BM72`2M+2c M/ UkV  M2m`Q@bvK#QHB+ 7mbBQM KQ/2H rBi?\n"
)

CLEAN_ENGLISH = (
    "Chapter 6\n"
    "Hybrid CPT Bayesian Reranking and Finer-CAM Neuro-Symbolic Fusion\n"
    "Building on the neuro-symbolic framework established in Chapter 5, this chapter\n"
    "further investigates two complementary research directions: a Bayesian reranking\n"
    "mechanism centered on Conditional Probability Tables, which provides quantifiable\n"
    "uncertainty estimates for legal inference, and a neuro-symbolic fusion model with\n"
    "Finer-CAM as its backbone that dynamically integrates semantic representations.\n"
)

CLEAN_CHINESE = (
    "第六章 混合 CPT 貝氏重排序與神經符號融合\n"
    "本章建立在第五章的神經符號框架之上，進一步探討兩個互補的研究方向：\n"
    "一是以條件機率表為核心的貝氏重排序機制，為法律推論提供可量化的不確定性估計；\n"
    "二是以 Finer-CAM 為骨幹的神經符號融合模型，透過可學習的注意力機制\n"
    "動態整合語意表示與符號統計特徵。兩個方向都建立在第五章推論引擎的中間結果上。\n"
)

# A stats-flavoured paragraph: asterisks for significance, but nowhere near the
# 3% threshold. Guards against the detector false-positiving on real prose.
MATH_HEAVY = (
    "We report significance levels (* p<0.05, ** p<0.01, *** p<0.001) across runs.\n"
    "The model reaches 82.2% Top-1 accuracy, improving over the 76.62% baseline by\n"
    "5.58 percentage points. The geometric mean aggregation avoids the product effect\n"
    "where statutes with more elements are systematically underscored. Brier Score\n"
    "drops from 1.646 to 0.254, indicating substantially better calibration overall.\n"
)


def test_garbled_pdf_text_is_detected():
    assert _looks_garbled(_spans(GARBLED_SAMPLE)) is True


def test_clean_english_is_not_flagged():
    assert _looks_garbled(_spans(CLEAN_ENGLISH)) is False


def test_clean_chinese_is_not_flagged():
    assert _looks_garbled(_spans(CLEAN_CHINESE)) is False


def test_stats_heavy_prose_is_not_flagged():
    # Real false-positive guard: asterisks/percent signs must not trip OCR.
    assert _looks_garbled(_spans(MATH_HEAVY)) is False


def test_short_text_skips_ocr():
    # Under the 200-char floor we don't have enough signal — never OCR.
    assert _looks_garbled(_spans("Short abstract.\n")) is False


def test_empty_spans_skip_ocr():
    assert _looks_garbled([]) is False
