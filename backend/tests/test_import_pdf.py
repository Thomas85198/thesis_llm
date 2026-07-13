"""Tests for editor-mode PDF import: native-text path (pymupdf4llm → markdown
→ ProseMirror)、掃描檔偵測、OCR 段落重組，以及 /api/editor/import 的 PDF job 流程。

不觸網、不碰 LLM；OCR 一律 monkeypatch（本機/CI 不保證有 tesseract）。
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import pymupdf
import pytest
from fastapi.testclient import TestClient

from app import import_doc, pipeline
from main import app

client = TestClient(app)


# ---------- fixtures ----------


@pytest.fixture(scope="module")
def native_pdf() -> bytes:
    """兩頁 PDF：大字標題、兩級 heading、內文、一張圖與其 caption。"""
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text(
        (72, 80), "A Study of Knowledge Graphs", fontsize=22, fontname="helv"
    )
    page.insert_text((72, 130), "1. Introduction", fontsize=16, fontname="hebo")
    body = (
        "Knowledge graphs represent entities and relations. This paragraph is "
        "body text at normal size, long enough to look like prose."
    )
    page.insert_textbox(pymupdf.Rect(72, 150, 520, 260), body, fontsize=11)
    page.insert_text((72, 290), "1.1 Motivation", fontsize=13, fontname="hebo")
    page.insert_textbox(
        pymupdf.Rect(72, 300, 520, 400),
        "We study motivation here with more prose text to fill the paragraph.",
        fontsize=11,
    )
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 120, 80))
    pix.clear_with(90)
    for x in range(120):  # 純色圖會被 _is_blank_image 濾掉，加點紋理
        pix.set_pixel(x, 40, (200, 30, 30))
    page2 = doc.new_page()
    page2.insert_text((72, 80), "2. Method", fontsize=16, fontname="hebo")
    page2.insert_image(pymupdf.Rect(72, 120, 292, 240), pixmap=pix)
    page2.insert_textbox(
        pymupdf.Rect(72, 260, 520, 360),
        "Figure 1: The system architecture diagram.",
        fontsize=10,
    )
    raw = doc.tobytes()
    doc.close()
    return raw


@pytest.fixture(scope="module")
def scanned_pdf(native_pdf: bytes) -> bytes:
    """把每頁 render 成點陣圖再組回去 → 無文字層的掃描檔。"""
    src = pymupdf.open(stream=native_pdf, filetype="pdf")
    scan = pymupdf.open()
    for pg in src:
        pix = pg.get_pixmap(dpi=100)
        p2 = scan.new_page(width=pg.rect.width, height=pg.rect.height)
        p2.insert_image(pg.rect, pixmap=pix)
    raw = scan.tobytes()
    src.close()
    scan.close()
    return raw


def _find(node: dict, type_name: str) -> list[dict]:
    out: list[dict] = []

    def walk(n: dict) -> None:
        if n.get("type") == type_name:
            out.append(n)
        for ch in n.get("content", []):
            walk(ch)

    walk(node)
    return out


def _all_text(node: dict) -> str:
    if node.get("type") == "text":
        return node.get("text", "")
    return "".join(_all_text(ch) for ch in node.get("content", []))


# ---------- native path ----------


def test_from_pdf_native_structure(native_pdf: bytes):
    title, doc = import_doc.to_prosemirror("thesis.pdf", native_pdf)
    assert title == "A Study of Knowledge Graphs"
    headings = _find(doc, "heading")
    texts = [_all_text(h) for h in headings]
    assert any("Introduction" in t for t in texts)
    assert any("Motivation" in t for t in texts)
    # H1 已被抽為 title，其餘 heading 上移一級 → Introduction 是 level 1
    intro = next(h for h in headings if "Introduction" in _all_text(h))
    assert intro["attrs"]["level"] == 1
    assert any("represent entities" in _all_text(p) for p in _find(doc, "paragraph"))


def test_from_pdf_persists_images_and_caption(native_pdf: bytes):
    _, doc = import_doc.to_prosemirror("thesis.pdf", native_pdf)
    figures = _find(doc, "figure")
    assert figures, "embedded image should become a figure node"
    fig = figures[0]
    src = fig["attrs"]["src"]
    assert src.startswith("/api/editor/images/img_")
    saved = Path(os.environ["UPLOAD_DIR"]) / src.rsplit("/", 1)[-1]
    assert saved.is_file() and saved.stat().st_size > 0
    # 「Figure 1: …」caption 段落應折進 figure node（_attach_captions）
    assert "architecture" in fig["attrs"]["caption"]


def test_localize_drops_figures_with_dead_tmp_paths(tmp_path):
    doc = {
        "type": "doc",
        "content": [
            {"type": "figure", "attrs": {"src": str(tmp_path / "gone.png")}},
            {"type": "figure", "attrs": {"src": "https://example.com/x.png"}},
            {"type": "paragraph"},
        ],
    }
    import_doc._localize_pdf_images(doc, tmp_path)
    types = [b["type"] for b in doc["content"]]
    assert types == ["figure", "paragraph"]  # 死的暫存路徑被丟掉、外部 URL 保留
    assert doc["content"][0]["attrs"]["src"].startswith("https://")


def test_from_pdf_never_lets_pymupdf4llm_ocr(monkeypatch, native_pdf: bytes):
    """回歸鎖：pymupdf4llm 1.28 layout 模式會自行決定對頁面跑 OCR 且預設
    ocr_language='eng'——在有 tesseract 的主機上把中文論文整本抽成亂碼
    （無 tesseract 的主機正常，環境相依、極難察覺）。掃描檔一律走我們
    自己的 pdf_needs_ocr → from_pdf_ocr，pymupdf4llm 的 OCR 必須關死。"""
    import pymupdf4llm

    captured: dict = {}
    real = pymupdf4llm.to_markdown

    def spy(doc, **kwargs):
        captured.update(kwargs)
        return real(doc, **kwargs)

    monkeypatch.setattr(pymupdf4llm, "to_markdown", spy)
    import_doc.from_pdf(native_pdf)
    assert captured.get("use_ocr") is False
    assert captured.get("ignore_code") is True


def test_from_pdf_strips_inline_code_marks(monkeypatch, native_pdf: bytes):
    """CJK 字型被 pymupdf4llm 誤判 monospace → 整段中文包 `backticks`；
    匯入後不得殘留 code mark。"""
    import pymupdf4llm

    monkeypatch.setattr(
        pymupdf4llm,
        "to_markdown",
        lambda doc, **kw: "# 標題\n\n`心流、使用與滿足` 之影響\n",
    )
    _, doc = import_doc.from_pdf(native_pdf)
    marks: list[str] = []

    def walk(n):
        for m in n.get("marks", []):
            marks.append(m["type"])
        for c in n.get("content", []):
            walk(c)

    walk(doc)
    assert "code" not in marks
    assert "心流、使用與滿足" in _all_text(doc)


def test_neutralize_watermarks_strips_repeated_image():
    """校徽浮水印＝同一 image xref 被幾乎每頁引用。留著會讓 layout 模型把
    浮水印區判成 picture、內文被烤進圖裡；必須從 content stream 拔掉 Do。"""
    doc = pymupdf.open()
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 60, 60))
    pix.clear_with(200)
    wm_xref = 0
    for i in range(6):
        page = doc.new_page()
        page.insert_text((72, 100), f"Page {i} body text", fontsize=11)
        if wm_xref == 0:
            wm_xref = page.insert_image(pymupdf.Rect(200, 300, 400, 500), pixmap=pix)
        else:  # 重用同一個 xref，模擬每頁同一張浮水印
            page.insert_image(pymupdf.Rect(200, 300, 400, 500), xref=wm_xref)
    # 對照組：只出現一次的真圖
    uniq = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 30, 30))
    uniq.clear_with(90)
    doc[0].insert_image(pymupdf.Rect(72, 200, 172, 260), pixmap=uniq)

    assert import_doc._neutralize_watermarks(doc) == 1
    # 浮水印在每一頁都不再被繪製；唯一真圖仍在第 0 頁
    for i in range(6):
        shown = doc[i].get_image_info()
        assert len(shown) == (1 if i == 0 else 0)
    doc.close()


def test_blank_image_detection():
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 40))
    pix.clear_with(255)
    assert import_doc._is_blank_image(pix.tobytes("png")) is True
    for x in range(40):
        pix.set_pixel(x, 20, (10, 20, 30))
    assert import_doc._is_blank_image(pix.tobytes("png")) is False
    assert import_doc._is_blank_image(b"not an image") is False


# ---------- scanned detection + OCR paragraph grouping ----------


def test_pdf_needs_ocr(native_pdf: bytes, scanned_pdf: bytes):
    assert import_doc.pdf_needs_ocr(native_pdf) is False
    assert import_doc.pdf_needs_ocr(scanned_pdf) is True


def test_from_pdf_ocr_groups_paragraphs(monkeypatch, native_pdf: bytes):
    """行距斷段：頁內大 gap 與換頁都要切段；CJK 行直接相連、英文行以空白相接。"""

    def fake_ocr(raw: bytes):
        mk = lambda page, y0, y1, text: pipeline.Span(  # noqa: E731
            page=page, bbox=(72.0, y0, 500.0, y1), text=text, char_start=0, char_end=0
        )
        return [
            mk(0, 100, 112, "first line\n"),
            mk(0, 114, 126, "second line\n"),  # 小 gap → 同段
            mk(0, 160, 172, "new paragraph\n"),  # 大 gap → 斷段
            mk(1, 80, 92, "知識圖譜是一種\n"),  # 換頁 → 斷段
            mk(1, 94, 106, "結構化表示法\n"),  # CJK 相連不加空白
        ]

    monkeypatch.setattr(pipeline, "_extract_pdf_spans_ocr", fake_ocr)
    _, doc = import_doc.from_pdf_ocr(native_pdf)
    paras = [_all_text(p) for p in _find(doc, "paragraph")]
    assert paras == [
        "first line second line",
        "new paragraph",
        "知識圖譜是一種結構化表示法",
    ]


# ---------- pdf post-processing（layout 模式病灶的回歸鎖）----------


def _pdf_with_md(monkeypatch, native_pdf: bytes, md: str) -> dict:
    """走 to_prosemirror 完整鏈（含 _relink_directories），markdown 由測試指定。"""
    import pymupdf4llm

    monkeypatch.setattr(pymupdf4llm, "to_markdown", lambda doc, **kw: md)
    _, doc = import_doc.to_prosemirror("test.pdf", native_pdf)
    return doc


def test_pdf_cover_demoted_and_levels_renumbered(monkeypatch, native_pdf):
    md = (
        "## 長庚大學資訊管理學系\n\n## 碩士論文\n\n"
        "# 誌謝\n\n感謝大家。\n\n"
        "# 第一章 緒論\n\n### 1.1 研究背景與動機\n\n內文。\n\n"
        "### 1.1.1 小節\n\n內文。\n\n"
        "# 參考文獻\n\n### 網路資源\n\n# 附錄一 問卷\n\n內文。\n"
    )
    doc = _pdf_with_md(monkeypatch, native_pdf, md)
    heads = [
        (b["attrs"]["level"], _all_text(b))
        for b in doc["content"]
        if b["type"] == "heading"
    ]
    assert (1, "誌謝") in heads
    assert (2, "1.1 研究背景與動機") in heads  # H3 → H2（依編號）
    assert (3, "1.1.1 小節") in heads
    assert all("長庚大學" not in t and "碩士論文" != t for _, t in heads)  # 封面降級
    assert all(t != "網路資源" for _, t in heads)  # 參考文獻區字級誤判降級
    assert any(t.startswith("附錄") and lv == 1 for lv, t in heads)


def test_pdf_page_boundary_paragraph_and_table_merge(monkeypatch, native_pdf):
    md = (
        "# 第一章 緒論\n\n"
        "Instagram 是目前最容\n\n--- end of page.page_number=2 ---\n\n"
        "易導致年輕族群產生心理症狀的平台，因此本研究針對其使用者進行分析。\n\n"
        "|構面|定義|\n|---|---|\n|心流|甲|\n\n"
        "--- end of page.page_number=3 ---\n\n"
        "|構面|定義|\n|---|---|\n|成癮|乙|\n"
    )
    doc = _pdf_with_md(monkeypatch, native_pdf, md)
    text = _all_text(doc)
    assert "end of page" not in text  # 標記用完即棄
    assert "最容易導致年輕族群" in text.replace(" ", "")  # 跨頁段落接回
    tables = _find(doc, "tableBlock")
    assert len(tables) == 1  # 跨頁表合併
    rows = _find(tables[0], "tableRow")
    assert len(rows) == 3  # 表頭 + 兩列資料（重複表頭已去除）


def test_pdf_lists_flattened(monkeypatch, native_pdf):
    long_a = "性別：男性共 172 位，占總人數四成以上，其餘皆為女性受訪者。"
    md = (
        "# 第一章 緒論\n\n"
        f"1. {long_a}\n2. 年齡：以 20 到 29 歲為大宗。\n\n"
        "- 短項目一\n- 短項目二\n\n"
        "# 參考文獻\n\n- 朱美慧（2000）。研究一。\n- 江欣茹（2004）。研究二。\n"
    )
    doc = _pdf_with_md(monkeypatch, native_pdf, md)
    ordered = _find(doc, "orderedList")
    bullets = _find(doc, "bulletList")
    assert not ordered  # 字面編號攤平、保留編號
    assert f"1. {long_a}" in [
        _all_text(b) for b in doc["content"] if b["type"] == "paragraph"
    ]
    assert len(bullets) == 1  # 短 bullet 清單保留
    # 參考文獻區清單攤平成一條一段
    paras = [_all_text(b) for b in doc["content"] if b["type"] == "paragraph"]
    assert any(p.startswith("朱美慧") for p in paras)
    assert any(p.startswith("江欣茹") for p in paras)


def test_pdf_toc_debris_table_replaced(monkeypatch, native_pdf):
    md = (
        "# 測試論文\n\n"  # 第一個 H1 會被抽成文件標題，墊一個
        "# 目錄\n\n"
        "|第一章 緒論.......... 1|\n|---|\n|1.1 研究背景................ 2|\n|誌謝............ iii|\n\n"
        "# 第一章 緒論\n\n內文。\n"
    )
    doc = _pdf_with_md(monkeypatch, native_pdf, md)
    assert _find(doc, "tableOfContents"), "live TOC node inserted"
    assert not _find(doc, "tableBlock"), "dot-leader debris table consumed"


def test_pdf_reference_entries_rejoined(monkeypatch, native_pdf):
    md = (
        "# 測試論文\n\n"  # 第一個 H1 會被抽成文件標題，墊一個
        "# 參考文獻\n\n"
        "Bryant, J., & Miron, D. (2004). Theory and research in mass\n\n"
        "communication. Journal of communication, 54(4), 662-704.\n\n"
        "Instagram. (2010). Press release. Retrieved from https://instagram-\n\n"
        "press.com/blog/2010/10/06/instagram-launches-2/.\n"
    )
    doc = _pdf_with_md(monkeypatch, native_pdf, md)
    paras = [_all_text(b) for b in doc["content"] if b["type"] == "paragraph"]
    assert any("Theory and research in mass communication" in p for p in paras)
    assert any("https://instagram-press.com/blog" in p for p in paras)


def test_pdf_cjk_gaps_stripped(monkeypatch, native_pdf):
    md = "# 第一章 緒論\n\n本研究探討網路成 癮與（ 2000 ）年的現象。\n"
    doc = _pdf_with_md(monkeypatch, native_pdf, md)
    text = _all_text(doc)
    assert "網路成癮" in text
    assert "（2000）" in text


def test_pdf_caption_source_split(monkeypatch, native_pdf):
    md = (
        "# 第一章 緒論\n\n"
        "![](https://example.com/x.png)\n\n"
        "圖1-1 全球社群媒體使用概況 資料來源：Smart Insights (2018)\n"
    )
    doc = _pdf_with_md(monkeypatch, native_pdf, md)
    figs = _find(doc, "figure")
    assert figs and "資料來源" not in figs[0]["attrs"]["caption"]
    assert "全球社群媒體使用概況" in figs[0]["attrs"]["caption"]
    assert any(
        _all_text(b).startswith("資料來源")
        for b in doc["content"]
        if b["type"] == "paragraph"
    )  # 資料來源留在正文（對齊 DOCX）


def test_pdf_trailing_enum_heading_split(monkeypatch, native_pdf):
    md = (
        "# 第一章 緒論\n\n"
        "研究結果顯示兩者呈正相關，證實假說成立。（二）感知隱私權\n\n"
        "當社群媒體要求愈來愈多使用者資訊，使用者便會開始關注隱私。\n"
    )
    doc = _pdf_with_md(monkeypatch, native_pdf, md)
    heads = [_all_text(b) for b in doc["content"] if b["type"] == "heading"]
    assert "（二）感知隱私權" in heads


def test_repair_scrambled_paragraph(monkeypatch, native_pdf):
    """孤兒標點段落用原生 span 文字（順序正確）重建。"""
    correct = (
        "超過八成都有臉書 (Facebook) 帳號，其次則依序為 YouTube (60.4%)、"
        "PTT (37.8%)、Instagram (32.7%)。基於台灣民眾社群媒體的使用情況本研究繼續分析。"
    )
    scrambled = (
        "超過八成都有臉書 (Facebook) 、 、 。 帳號，其次則依序為 YouTube (60.4%) "
        "PTT (37.8%) Instagram (32.7%) 基於台灣民眾社群媒體的使用情況本研究繼續分析。"
    )

    def fake_spans(raw):
        return [
            pipeline.Span(
                page=0, bbox=(0, 0, 0, 0), text=line + "\n", char_start=0, char_end=0
            )
            for line in [correct[: len(correct) // 2], correct[len(correct) // 2 :]]
        ]

    monkeypatch.setattr(pipeline, "_extract_pdf_spans_native", fake_spans)
    blocks = [{"type": "paragraph", "content": [{"type": "text", "text": scrambled}]}]
    import_doc._repair_scrambled_paragraphs(blocks, b"%PDF-fake")
    fixed = _all_text(blocks[0]).replace(" ", "")
    assert "(60.4%)、PTT(37.8%)、Instagram(32.7%)。" in fixed


# ---------- /api/editor/import PDF job flow ----------


def _poll_job(job_id: str, timeout: float = 30.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        res = client.get(f"/api/editor/import/jobs/{job_id}")
        assert res.status_code == 200
        body = res.json()
        if body["status"] != "processing":
            return body
        time.sleep(0.05)
    raise AssertionError("import job did not finish in time")


def test_import_pdf_route_job_flow(native_pdf: bytes):
    res = client.post(
        "/api/editor/import",
        files={"file": ("thesis.pdf", native_pdf, "application/pdf")},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "processing" and body["job_id"]
    done = _poll_job(body["job_id"])
    assert done["status"] == "done"
    assert done["title"] == "A Study of Knowledge Graphs"
    assert done["content_json"]["type"] == "doc"


def test_import_pdf_route_error_surfaces():
    res = client.post(
        "/api/editor/import",
        files={"file": ("broken.pdf", b"%PDF-not really a pdf", "application/pdf")},
    )
    assert res.status_code == 200
    done = _poll_job(res.json()["job_id"])
    assert done["status"] == "error"
    assert "could not parse .pdf" in done["detail"]


def test_import_job_unknown_id_404():
    assert client.get("/api/editor/import/jobs/nope").status_code == 404


def test_non_pdf_import_still_synchronous():
    res = client.post(
        "/api/editor/import",
        files={"file": ("note.md", b"# Title\n\nBody.", "text/markdown")},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["title"] == "Title" and "job_id" not in body
