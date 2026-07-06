"""md/txt 上傳 → PDF 轉檔（分析前置步驟）。

.md/.txt 沒有頁面座標，前端預覽器與缺陷 highlight 只認 PDF 的 page+bbox；
同時 pipeline 的 SECTION_PATTERNS 也認不得 `## 緒論` 這種 markdown 標題
（`^\\s*` 起手，`#` 不是空白 → 全部落 section=Other）。與其為文字檔另養
一套檢視器與定位邏輯，不如在分析前把它排版成真 PDF，之後整條鏈
（PyMuPDF 抽取、預覽、highlight、章節偵測）走既有 PDF 路徑。

轉檔鏈全部復用編輯器子系統的既有零件：
    import_doc.from_markdown / from_text  → ProseMirror JSON
    export_doc.to_latex(template="article") → LaTeX
    latex_compile.compile_pdf              → 內建 XeLaTeX

兩個排版調整是為了讓轉出的 PDF 能被 SECTION_PATTERNS 命中：
1. 關掉 LaTeX 章節自動編號（否則「摘要」變成「1 摘要」，Abstract 的
   pattern 沒有數字前綴、直接失配）。
2. 剝掉 md 標題自帶的編號（「## 1 緒論」→「緒論」）——LaTeX 的編號
   已關，留著只會變成失配來源；剝完的裸標題正是 pattern 要的形狀。
"""

from __future__ import annotations

import re
from pathlib import Path

from . import export_doc, import_doc, latex_compile

# 與 pipeline._SEC_NUM 同族：阿拉伯數字（含 1.2 式）或中文數字，
# 後面可跟頓號/句點/括號。只剝標題開頭的一段。
_HEADING_NUM_RE = re.compile(
    r"^\s*[（(]?\s*(?:\d+(?:\.\d+)*\.?|[一二三四五六七八九十百]+)\s*[)）、.．]?\s*"
)


def _strip_heading_numbers(doc: dict) -> None:
    """把 heading 首個 text node 開頭的編號剝掉（原地修改）。

    剝完若變空字串（標題只有編號，如「## 3.1」）就保留原文，
    寧可失配也不要生出空標題。
    """
    for block in doc.get("content") or []:
        if block.get("type") != "heading":
            continue
        children = block.get("content") or []
        if not children or children[0].get("type") != "text":
            continue
        original = children[0].get("text") or ""
        stripped = _HEADING_NUM_RE.sub("", original, count=1)
        if stripped:
            children[0]["text"] = stripped


def to_pdf(raw: bytes, filename: str) -> bytes:
    """把 .md / .txt 的原始 bytes 排版成 PDF bytes。

    失敗會拋例外（LatexCompileError / LatexNotInstalled / UnicodeDecodeError
    以外的解析錯誤）——呼叫端負責 fallback 回未轉檔的舊行為。
    """
    text = raw.decode("utf-8", errors="replace")
    if filename.lower().endswith(".md"):
        title, doc = import_doc.from_markdown(text)
    else:
        title, doc = import_doc.from_text(text)
    _strip_heading_numbers(doc)

    document = {"title": title or Path(filename).stem, "content_json": doc}
    tex, images = export_doc.to_latex(
        document,
        style="apa",
        refs_label="參考文獻",
        template="article",
        locale="zh-Hant",
    )
    # 關章節編號（見模組 docstring 第 1 點）。
    tex = tex.replace(
        "\\begin{document}",
        "\\setcounter{secnumdepth}{-1}\n\\begin{document}",
        1,
    )
    return latex_compile.compile_pdf(tex, images)
