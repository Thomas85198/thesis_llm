"""Tests for editor-mode export: ProseMirror JSON → .docx / .tex."""
from __future__ import annotations

import io

from docx import Document

from app import export_doc

# A doc exercising: heading, paragraph with bold + a citation, a bullet list, and
# two citations (one repeated) so numbering / dedup is covered.
CITE_A = {
    "type": "citation",
    "attrs": {"openalexId": "W1", "authors": "Ashish Vaswani, Noam Shazeer",
              "year": 2017, "title": "Attention Is All You Need", "venue": "NeurIPS"},
}
CITE_B = {
    "type": "citation",
    "attrs": {"openalexId": "W2", "authors": "Jane Doe", "year": 2020,
              "title": "A Study", "venue": "JML"},
}
DOC = {
    "type": "doc",
    "content": [
        {"type": "heading", "attrs": {"level": 1},
         "content": [{"type": "text", "text": "緒論"}]},
        {"type": "paragraph", "content": [
            {"type": "text", "text": "重點", "marks": [{"type": "bold"}]},
            {"type": "text", "text": "如下 "},
            CITE_A,
            {"type": "text", "text": " 與 "},
            CITE_B,
        ]},
        {"type": "bulletList", "content": [
            {"type": "listItem", "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "第一點 "}, CITE_A]}
            ]},
        ]},
    ],
}


# ---------- citation helpers ----------

def test_in_text_label_per_style():
    a = {"authors": "Ashish Vaswani, Noam Shazeer", "year": 2017}
    assert export_doc.in_text_label(a, "apa", 1) == "(Vaswani & Shazeer, 2017)"
    assert export_doc.in_text_label(a, "harvard", 1) == "(Vaswani & Shazeer, 2017)"
    assert export_doc.in_text_label(a, "chicago", 1) == "(Vaswani & Shazeer 2017)"
    assert export_doc.in_text_label(a, "mla", 1) == "(Vaswani & Shazeer)"
    assert export_doc.in_text_label(a, "ieee", 3) == "[3]"
    assert export_doc.in_text_label(a, "numeric", 3) == "[3]"
    assert export_doc.in_text_label({"authors": "", "year": None}, "apa", 1) == "(Anon., n.d.)"


def test_full_reference_per_style():
    a = {"authors": "A B", "year": 2020, "title": "A Study", "venue": "JML"}
    assert export_doc.full_reference(a, "apa", 1) == "A B (2020). A Study. JML."
    assert export_doc.full_reference(a, "mla", 1) == "A B. “A Study.” JML, 2020."
    assert export_doc.full_reference(a, "ieee", 5) == "[5] A B, “A Study,” JML, 2020."


def test_collect_citations_dedupes_by_first_appearance():
    cites = export_doc.collect_citations(DOC)
    assert [c["openalexId"] for c in cites] == ["W1", "W2"]  # W1 repeated → once, in order


# ---------- DOCX ----------

def test_to_docx_includes_text_citations_and_references():
    data = export_doc.to_docx({"title": "我的論文", "content_json": DOC}, "apa", "參考文獻")
    assert data[:2] == b"PK"  # docx is a zip
    doc = Document(io.BytesIO(data))
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "(Vaswani & Shazeer, 2017)" in text  # in-text APA marker (2 authors)
    assert "參考文獻" in text  # reference heading
    assert "Attention Is All You Need" in text  # reference entry


def test_to_docx_numeric_style_numbers_in_order():
    data = export_doc.to_docx({"title": "t", "content_json": DOC}, "numeric", "References")
    doc = Document(io.BytesIO(data))
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "[1]" in text and "[2]" in text  # first-appearance numbering


# ---------- LaTeX ----------

def test_to_latex_structure_and_escaping():
    tex = export_doc.to_latex({"title": "100% 文字 & 符號", "content_json": DOC}, "apa", "參考文獻")
    assert "\\documentclass{article}" in tex
    assert "\\usepackage{ctex}" in tex  # CJK support
    assert "\\section{緒論}" in tex
    assert "\\textbf{重點}" in tex
    assert "\\begin{itemize}" in tex
    assert "(Vaswani \\& Shazeer, 2017)" in tex  # marker's & is LaTeX-escaped
    assert "\\section*{參考文獻}" in tex
    # special chars in the title are escaped
    assert "100\\% 文字 \\& 符號" in tex


def test_figure_caption_kept_figurelist_skipped():
    doc = {"type": "doc", "content": [
        {"type": "figure", "attrs": {"src": "x.png", "caption": "流程圖"}},
        {"type": "figureList"},
    ]}
    tex = export_doc.to_latex({"title": "t", "content_json": doc}, "apa", "References")
    assert "流程圖" in tex  # caption preserved, not silently dropped
    import io as _io
    from docx import Document as _Doc
    data = export_doc.to_docx({"title": "t", "content_json": doc}, "apa", "References")
    text = "\n".join(p.text for p in _Doc(_io.BytesIO(data)).paragraphs)
    assert "流程圖" in text


def test_to_latex_empty_doc_no_references_section():
    tex = export_doc.to_latex({"title": "t", "content_json": {"type": "doc", "content": []}}, "apa", "References")
    assert "\\section*{References}" not in tex  # no citations → no ref list
    assert "\\begin{document}" in tex and "\\end{document}" in tex
