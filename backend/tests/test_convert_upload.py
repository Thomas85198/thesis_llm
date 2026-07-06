"""Tests for the md/txt → PDF conversion step (analysis pre-pass).

compile_pdf is mocked — these tests assert the LaTeX we hand to XeLaTeX,
not the PDF bytes. What matters downstream: headings end up as bare text
（「緒論」not「1 緒論」）so pipeline.SECTION_PATTERNS can match them.
"""

from __future__ import annotations

import pytest

from app import convert_upload

MD = """# 基於檢索的問答系統

## 摘要

本研究提出一個系統。

## 1 緒論

大型語言模型有幻覺問題。

## 2 方法

系統分為三個模組。
""".encode()


@pytest.fixture()
def captured_tex(monkeypatch):
    box: dict = {}

    def fake_compile(tex, images):
        box["tex"] = tex
        box["images"] = images
        return b"%PDF-fake"

    monkeypatch.setattr(convert_upload.latex_compile, "compile_pdf", fake_compile)
    return box


def test_md_headings_become_bare_sections(captured_tex):
    out = convert_upload.to_pdf(MD, "t.md")

    assert out == b"%PDF-fake"
    tex = captured_tex["tex"]
    # md 自帶的編號被剝掉：pattern 要的是裸標題
    assert "\\section{緒論}" in tex
    assert "\\section{方法}" in tex
    assert "\\section{摘要}" in tex
    assert "1 緒論" not in tex


def test_latex_section_numbering_is_disabled(captured_tex):
    convert_upload.to_pdf(MD, "t.md")

    tex = captured_tex["tex"]
    inject = "\\setcounter{secnumdepth}{-1}\n\\begin{document}"
    assert inject in tex
    # 注入點在 \begin{document} 之前恰好一次
    assert tex.count("\\setcounter{secnumdepth}{-1}") == 1


def test_md_h1_becomes_document_title(captured_tex):
    convert_upload.to_pdf(MD, "t.md")

    assert "基於檢索的問答系統" in captured_tex["tex"]
    assert "\\maketitle" in captured_tex["tex"]


def test_txt_goes_through_plain_text_parser(captured_tex):
    convert_upload.to_pdf("第一段。\n\n第二段。".encode(), "notes.txt")

    tex = captured_tex["tex"]
    assert "第一段。" in tex
    assert "第二段。" in tex


def test_untitled_file_falls_back_to_filename_stem(captured_tex):
    convert_upload.to_pdf("只有內文沒有標題。".encode(), "draft-v2.txt")

    assert "draft-v2" in captured_tex["tex"]


def test_compile_failure_propagates_to_caller(monkeypatch):
    def boom(tex, images):
        raise convert_upload.latex_compile.LatexCompileError("missing font")

    monkeypatch.setattr(convert_upload.latex_compile, "compile_pdf", boom)

    with pytest.raises(convert_upload.latex_compile.LatexCompileError):
        convert_upload.to_pdf(MD, "t.md")


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("1 緒論", "緒論"),
        ("3.1 系統架構", "系統架構"),
        ("一、研究背景", "研究背景"),
        ("（3）評估", "評估"),
        ("緒論", "緒論"),  # 沒編號 → 原樣
        ("3.1", "3.1"),  # 只有編號 → 保留原文，不生空標題
    ],
)
def test_strip_heading_numbers(raw, expected):
    doc = {
        "type": "doc",
        "content": [
            {"type": "heading", "content": [{"type": "text", "text": raw}]},
        ],
    }

    convert_upload._strip_heading_numbers(doc)

    assert doc["content"][0]["content"][0]["text"] == expected


def test_strip_skips_non_heading_and_empty_blocks():
    doc = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "1 內文"}]},
            {"type": "heading", "content": []},
        ],
    }

    convert_upload._strip_heading_numbers(doc)  # must not raise

    assert doc["content"][0]["content"][0]["text"] == "1 內文"
