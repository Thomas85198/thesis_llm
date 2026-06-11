"""Smoke test for server-side XeLaTeX compilation. Skipped where TeX isn't
installed (local venvs) — it runs inside the backend Docker image."""
from __future__ import annotations

import shutil

import pytest

from app import export_doc, latex_compile

pytestmark = pytest.mark.skipif(
    shutil.which("xelatex") is None, reason="xelatex not installed"
)


def _doc():
    cell = lambda txt: {"type": "tableCell", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": txt}]}
    ]}
    return {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 1},
         "content": [{"type": "text", "text": "緒論"}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "繁體中文內容，為了驗證編譯。"}]},
        {"type": "tableBlock", "content": [
            {"type": "tableCaption", "content": [{"type": "text", "text": "構面"}]},
            {"type": "table", "content": [
                {"type": "tableRow", "content": [cell("構面"), cell("我會使用 Instagram 去學習知識型內容，並且持續關注流行趨勢。")]},
            ]},
        ]},
    ]}


def test_compile_pdf_cjk_doc():
    tex, images = export_doc.to_latex(
        {"title": "編譯測試", "content_json": _doc()}, "apa", "參考文獻"
    )
    pdf = latex_compile.compile_pdf(tex, images)
    assert pdf[:5] == b"%PDF-"
    assert len(pdf) > 1000


def test_compile_error_carries_log_tail():
    with pytest.raises(latex_compile.LatexCompileError) as ei:
        latex_compile.compile_pdf("\\documentclass{article}\\begin{document}\\badmacro\\end{document}", [])
    assert "badmacro" in str(ei.value)
