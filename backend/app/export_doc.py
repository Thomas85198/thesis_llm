"""Editor-mode export: TipTap (ProseMirror) JSON → .docx / .tex.

Walks the stored document tree and renders block/inline nodes, including the
custom inline `citation` atom, into Word and LaTeX. In-text citation markers and
the trailing reference list mirror frontend/lib/citation-format.ts so an export
reads exactly like what the author sees on screen.
"""
from __future__ import annotations

import base64
import io
import os
import re
from pathlib import Path
from typing import Any

import httpx
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches


# ---------- image fetching (for embedding figures in export) ----------

_IMG_EXTS = {"png", "jpg", "jpeg", "gif", "webp"}
_IMG_PATH_RE = re.compile(r"/api/editor/images/([\w.\-]+)$")
_MAX_IMG_BYTES = 10 * 1024 * 1024


def _upload_dir() -> Path:
    # Mirror routes._resolve_upload_dir (avoid a circular import).
    explicit = os.getenv("UPLOAD_DIR")
    if explicit:
        return Path(explicit)
    data_dir = os.getenv("DATA_DIR")
    if data_dir:
        return Path(data_dir) / "uploads"
    return Path(__file__).parent.parent / "uploads"


def _image_bytes(src: str) -> tuple[bytes, str] | None:
    """Resolve a figure src to (bytes, ext). Reads our own uploads from disk;
    fetches external image URLs over HTTP. None on any failure."""
    if not src:
        return None
    try:
        m = _IMG_PATH_RE.search(src)
        if m:
            p = _upload_dir() / m.group(1)
            if not p.is_file():
                return None
            ext = p.suffix.lstrip(".").lower() or "png"
            return p.read_bytes(), (ext if ext in _IMG_EXTS else "png")
        with httpx.Client(timeout=15.0, follow_redirects=True) as cli:
            resp = cli.get(src)
            resp.raise_for_status()
            data = resp.content
        if len(data) > _MAX_IMG_BYTES:
            return None
        ext = src.rsplit(".", 1)[-1].split("?")[0].lower() if "." in src else "png"
        return data, (ext if ext in _IMG_EXTS else "png")
    except Exception:  # noqa: BLE001 — best-effort; fall back to caption text
        return None


def _img_data_uri(src: str) -> str:
    """Inline an image as a base64 data URI so a standalone HTML export (online
    preview / print-to-PDF / downloaded .html) carries the picture itself — the
    raw /api/editor/images/ path can't resolve outside the app's own origin."""
    img = _image_bytes(src)
    if not img:
        return src
    data, ext = img
    mime = "jpeg" if ext == "jpg" else ext
    return f"data:image/{mime};base64,{base64.b64encode(data).decode('ascii')}"


# ---------- citation formatting (mirror frontend lib/citation-format.ts) ----------

def _author_list(authors: str) -> list[str]:
    return [a.strip() for a in (authors or "").split(",") if a.strip()]


def _last_name(full: str) -> str:
    parts = full.strip().split()
    return parts[-1] if parts else full


def is_numbered(style: str) -> bool:
    """Styles that render in-text as a bracketed number rather than author–year."""
    return style in ("ieee", "numeric")


def _authors_short(authors: str) -> str:
    lst = _author_list(authors)
    if not lst:
        return "Anon."
    if len(lst) == 1:
        return _last_name(lst[0])
    if len(lst) == 2:
        return f"{_last_name(lst[0])} & {_last_name(lst[1])}"
    return f"{_last_name(lst[0])} et al."


def in_text_label(attrs: dict, style: str, number: int) -> str:
    if is_numbered(style):
        return f"[{number}]"
    short = _authors_short(attrs.get("authors", ""))
    y = attrs.get("year") or "n.d."
    if style == "mla":
        return f"({short})"
    if style == "chicago":
        return f"({short} {y})"
    return f"({short}, {y})"  # apa, harvard


def full_reference(attrs: dict, style: str, number: int) -> str:
    authors = attrs.get("authors") or "Anon."
    year = attrs.get("year") or "n.d."
    title = attrs.get("title") or "(untitled)"
    venue = attrs.get("venue") or ""
    if style == "mla":
        return f"{authors}. “{title}.”" + (f" {venue}," if venue else "") + f" {year}."
    if style == "chicago":
        return f"{authors}. “{title}.”" + (f" {venue}" if venue else "") + f" ({year})."
    if style == "harvard":
        return f"{authors} ({year}) ‘{title}’" + (f", {venue}" if venue else "") + "."
    if style in ("ieee", "numeric"):
        return f"[{number}] {authors}, “{title},”" + (f" {venue}," if venue else "") + f" {year}."
    return f"{authors} ({year}). {title}" + (f". {venue}" if venue else "") + "."  # apa


# ---------- tree walking ----------

def _children(node: dict) -> list[dict]:
    return node.get("content") or []


def collect_citations(doc: dict) -> list[dict]:
    """Distinct citation attrs by first appearance — the reference-list order."""
    seen: set[str] = set()
    out: list[dict] = []

    def walk(node: dict) -> None:
        if node.get("type") == "citation":
            a = node.get("attrs") or {}
            oid = a.get("openalexId")
            if oid and oid not in seen:
                seen.add(oid)
                out.append(a)
        for ch in _children(node):
            walk(ch)

    walk(doc)
    return out


def _citation_number(order: list[str], oid: str) -> int:
    """1-based first-appearance number (mirrors the editor's numeric labels)."""
    return order.index(oid) + 1 if oid in order else len(order) + 1


def _block_text(block: dict) -> str:
    """Flatten a block's inline text (used for code blocks)."""
    return "".join(
        n.get("text", "") for n in _children(block) if n.get("type") == "text"
    )


def _plain_text(node: dict) -> str:
    """Recursively gather visible text from a node (used for table cells)."""
    if node.get("type") == "text":
        return node.get("text", "")
    return "".join(_plain_text(ch) for ch in _children(node))


# Directory headings are skipped in a TOC — it shouldn't list itself.
_DIR_HEADING_TITLES = {
    "目錄", "目次", "圖目錄", "圖次", "表目錄", "表次",
    "table of contents", "contents", "list of figures", "list of tables",
}


def _collect_headings(doc: dict) -> list[tuple[int, str]]:
    """(level, text) for every content heading — source for a static table of contents."""
    out: list[tuple[int, str]] = []

    def walk(node: dict) -> None:
        if node.get("type") == "heading":
            text = _plain_text(node).strip()
            if text.lower() not in _DIR_HEADING_TITLES:
                out.append(((node.get("attrs") or {}).get("level", 1), text))
        for ch in _children(node):
            walk(ch)

    walk(doc)
    return out


def _prepared_content(document: dict) -> dict:
    """Expand each live `tableOfContents` node into a static, indented heading list
    so exports carry a real table of contents (the editor-only node has no body)."""
    raw = document.get("content_json") or {}
    if not isinstance(raw, dict):
        return {"type": "doc", "content": []}
    headings = _collect_headings(raw)
    blocks: list[dict] = []
    for b in raw.get("content") or []:
        if b.get("type") == "tableOfContents":
            for level, text in headings:
                if not text:
                    continue
                indent = "　" * (max(level, 1) - 1)  # full-width space per level
                blocks.append({"type": "paragraph",
                               "content": [{"type": "text", "text": f"{indent}{text}"}]})
        else:
            blocks.append(b)
    return {"type": "doc", "content": blocks}


def _table_parts(block: dict) -> tuple[str, list[list[str]]]:
    """Split a tableBlock into (caption, rows-of-cell-text)."""
    caption = ""
    rows: list[list[str]] = []
    for child in _children(block):
        if child.get("type") == "tableCaption":
            caption = _plain_text(child).strip()
        elif child.get("type") == "table":
            for tr in _children(child):
                rows.append([_plain_text(cell).strip() for cell in _children(tr)])
    return caption, rows


# ---------- DOCX ----------

def _add_inline_docx(paragraph, nodes: list[dict], style: str, order: list[str]) -> None:
    for n in nodes or []:
        t = n.get("type")
        if t == "text":
            run = paragraph.add_run(n.get("text", ""))
            marks = {m.get("type") for m in (n.get("marks") or [])}
            run.bold = "bold" in marks
            run.italic = "italic" in marks
            if "strike" in marks:
                run.font.strike = True
            if "code" in marks:
                run.font.name = "Courier New"
        elif t == "citation":
            a = n.get("attrs") or {}
            num = _citation_number(order, a.get("openalexId"))
            paragraph.add_run(in_text_label(a, style, num))
        elif t == "mathInline":
            paragraph.add_run(f"${(n.get('attrs') or {}).get('latex', '')}$")


def _render_block_docx(docx: Document, block: dict, style: str, order: list[str]) -> None:
    t = block.get("type")
    if t == "heading":
        level = (block.get("attrs") or {}).get("level", 1)
        p = docx.add_heading("", level=min(max(level, 1), 4))
        _add_inline_docx(p, _children(block), style, order)
    elif t in ("bulletList", "orderedList"):
        list_style = "List Bullet" if t == "bulletList" else "List Number"
        for item in _children(block):
            for child in _children(item):  # each listItem wraps paragraph(s)
                p = docx.add_paragraph(style=list_style)
                _add_inline_docx(p, _children(child), style, order)
    elif t == "blockquote":
        for child in _children(block):
            p = docx.add_paragraph(style="Quote")
            _add_inline_docx(p, _children(child), style, order)
    elif t == "codeBlock":
        p = docx.add_paragraph()
        run = p.add_run(_block_text(block))
        run.font.name = "Courier New"
    elif t == "horizontalRule":
        docx.add_paragraph("―" * 20)
    elif t == "figure":
        attrs = block.get("attrs") or {}
        cap = attrs.get("caption") or ""
        img = _image_bytes(attrs.get("src", ""))
        if img:
            try:
                docx.add_picture(io.BytesIO(img[0]), width=Inches(5.5))
                docx.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
            except Exception:  # noqa: BLE001 — unsupported image → caption only
                img = None
        capp = docx.add_paragraph()
        capp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        capp.add_run(cap or ("" if img else "[image]")).italic = True
    elif t == "figureList":
        pass  # an editor-only live aid; the figures themselves render inline
    elif t == "mathBlock":
        p = docx.add_paragraph()
        p.add_run(f"$${(block.get('attrs') or {}).get('latex', '')}$$")
    elif t == "tableBlock":
        caption, rows = _table_parts(block)
        if caption:
            docx.add_paragraph().add_run(caption).italic = True
        if rows:
            ncols = max(len(r) for r in rows)
            tbl = docx.add_table(rows=len(rows), cols=ncols)
            tbl.style = "Table Grid"
            for r, cells in enumerate(rows):
                for c in range(ncols):
                    tbl.cell(r, c).text = cells[c] if c < len(cells) else ""
    elif t == "tableList":
        pass  # editor-only live aid; the tables render inline
    else:  # paragraph and any unknown block → a plain paragraph of its inline content
        p = docx.add_paragraph()
        _add_inline_docx(p, _children(block), style, order)


def _set_academic_font(docx: Document) -> None:
    """Use a paper-like serif (Times New Roman + 標楷體 for CJK) for the body."""
    try:
        from docx.oxml.ns import qn

        normal = docx.styles["Normal"]
        normal.font.name = "Times New Roman"
        rpr = normal.element.get_or_add_rPr()
        rfonts = rpr.get_or_add_rFonts()
        rfonts.set(qn("w:ascii"), "Times New Roman")
        rfonts.set(qn("w:hAnsi"), "Times New Roman")
        rfonts.set(qn("w:eastAsia"), "標楷體")
    except Exception:  # noqa: BLE001 — styling is best-effort
        pass


def to_docx(document: dict, style: str, refs_label: str) -> bytes:
    content = _prepared_content(document)
    title = document.get("title") or "(untitled)"
    citations = collect_citations(content)
    order = [c.get("openalexId") for c in citations]

    docx = Document()
    _set_academic_font(docx)
    docx.add_heading(title, level=0)
    for block in _children(content):
        _render_block_docx(docx, block, style, order)
    if citations:
        docx.add_heading(refs_label, level=1)
        for i, c in enumerate(citations):
            docx.add_paragraph(full_reference(c, style, i + 1))

    buf = io.BytesIO()
    docx.save(buf)
    return buf.getvalue()


# ---------- LaTeX ----------

_LATEX_ESCAPE = {
    "\\": r"\textbackslash{}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "{": r"\{",
    "}": r"\}",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}


def _esc(s: str) -> str:
    return "".join(_LATEX_ESCAPE.get(ch, ch) for ch in (s or ""))


def _inline_latex(nodes: list[dict], style: str, order: list[str]) -> str:
    parts: list[str] = []
    for n in nodes or []:
        t = n.get("type")
        if t == "text":
            s = _esc(n.get("text", ""))
            marks = {m.get("type") for m in (n.get("marks") or [])}
            if "code" in marks:
                s = r"\texttt{" + s + "}"
            if "strike" in marks:
                s = r"\sout{" + s + "}"
            if "italic" in marks:
                s = r"\textit{" + s + "}"
            if "bold" in marks:
                s = r"\textbf{" + s + "}"
            parts.append(s)
        elif t == "citation":
            a = n.get("attrs") or {}
            num = _citation_number(order, a.get("openalexId"))
            parts.append(_esc(in_text_label(a, style, num)))
        elif t == "mathInline":
            # LaTeX source goes through verbatim — do NOT escape.
            parts.append(f"${(n.get('attrs') or {}).get('latex', '')}$")
    return "".join(parts)


def _render_block_latex(block: dict, style: str, order: list[str], ctx: dict) -> str:
    t = block.get("type")
    if t == "heading":
        level = (block.get("attrs") or {}).get("level", 1)
        cmd = {1: "section", 2: "subsection", 3: "subsubsection"}.get(level, "paragraph")
        return f"\\{cmd}{{{_inline_latex(_children(block), style, order)}}}\n\n"
    if t in ("bulletList", "orderedList"):
        env = "itemize" if t == "bulletList" else "enumerate"
        lines = [f"\\begin{{{env}}}"]
        for item in _children(block):
            inner = "".join(
                _inline_latex(_children(child), style, order) for child in _children(item)
            )
            lines.append(f"  \\item {inner}")
        lines.append(f"\\end{{{env}}}")
        return "\n".join(lines) + "\n\n"
    if t == "blockquote":
        inner = "".join(
            _inline_latex(_children(child), style, order) + "\n" for child in _children(block)
        )
        return f"\\begin{{quote}}\n{inner}\\end{{quote}}\n\n"
    if t == "codeBlock":
        return f"\\begin{{verbatim}}\n{_block_text(block)}\n\\end{{verbatim}}\n\n"
    if t == "horizontalRule":
        return "\\hrulefill\n\n"
    if t == "figure":
        attrs = block.get("attrs") or {}
        cap = attrs.get("caption") or ""
        img = _image_bytes(attrs.get("src", ""))
        if img:
            data, ext = img
            ctx["fig_n"] += 1
            fname = f"fig{ctx['fig_n']}.{ext}"
            ctx["images"].append((fname, data))
            capline = f"\\caption{{{_esc(cap)}}}\n" if cap else ""
            return (
                "\\begin{figure}[h]\n\\centering\n"
                f"\\includegraphics[width=0.8\\linewidth]{{{fname}}}\n{capline}\\end{{figure}}\n\n"
            )
        return f"\\textit{{[{_esc(cap or 'image')}]}}\n\n"
    if t == "figureList":
        return ""  # an editor-only live aid; the figures render inline
    if t == "mathBlock":
        return f"\\[{(block.get('attrs') or {}).get('latex', '')}\\]\n\n"
    if t == "tableBlock":
        caption, rows = _table_parts(block)
        if not rows:
            return ""
        ncols = max(len(r) for r in rows)
        body = " \\\\\n".join(
            " & ".join(_esc(r[c] if c < len(r) else "") for c in range(ncols)) for r in rows
        )
        cap = f"\\caption{{{_esc(caption)}}}\n" if caption else ""
        return (
            "\\begin{table}[h]\n\\centering\n"
            f"\\begin{{tabular}}{{{'|' + 'l|' * ncols}}}\n\\hline\n"
            f"{body} \\\\\n\\hline\n\\end{{tabular}}\n{cap}\\end{{table}}\n\n"
        )
    if t == "tableList":
        return ""  # editor-only live aid; the tables render inline
    return _inline_latex(_children(block), style, order) + "\n\n"


# LaTeX submission templates → the \documentclass line.
_LATEX_TEMPLATES = {
    "article": "\\documentclass{article}",
    "twocolumn": "\\documentclass[twocolumn]{article}",
    "ieee": "\\documentclass[conference]{IEEEtran}",
}


def to_latex(
    document: dict, style: str, refs_label: str, template: str = "article"
) -> tuple[str, list[tuple[str, bytes]]]:
    """Render to LaTeX. Returns (tex_source, images) where images is
    [(filename, bytes)] referenced by \\includegraphics — the route bundles them
    into a .zip when non-empty. `template` picks the \\documentclass."""
    content = _prepared_content(document)
    title = document.get("title") or "(untitled)"
    citations = collect_citations(content)
    order = [c.get("openalexId") for c in citations]

    ctx: dict = {"images": [], "fig_n": 0}
    body = "".join(_render_block_latex(b, style, order, ctx) for b in _children(content))
    refs = ""
    if citations:
        items = "\n".join(
            f"  \\item {_esc(full_reference(c, style, i + 1))}"
            for i, c in enumerate(citations)
        )
        refs = f"\\section*{{{_esc(refs_label)}}}\n\\begin{{itemize}}\n{items}\n\\end{{itemize}}\n\n"

    docclass = _LATEX_TEMPLATES.get(template, _LATEX_TEMPLATES["article"])
    # ctex → CJK; graphicx → figures; ulem → \sout; hyperref → links.
    tex = (
        f"{docclass}\n"
        "\\usepackage{ctex}\n"
        "\\usepackage{graphicx}\n"
        "\\usepackage[normalem]{ulem}\n"
        "\\usepackage{hyperref}\n"
        f"\\title{{{_esc(title)}}}\n"
        "\\author{}\n\\date{}\n"
        "\\begin{document}\n\\maketitle\n\n"
        + body
        + refs
        + "\\end{document}\n"
    )
    return tex, ctx["images"]


# ---------- Markdown / plain text / HTML (preview + browser-print PDF) ----------

def _inline_md(nodes: list[dict], style: str, order: list[str]) -> str:
    parts: list[str] = []
    for n in nodes or []:
        t = n.get("type")
        if t == "text":
            s = n.get("text", "")
            marks = {m.get("type") for m in (n.get("marks") or [])}
            if "code" in marks:
                s = f"`{s}`"
            if "strike" in marks:
                s = f"~~{s}~~"
            if "italic" in marks:
                s = f"*{s}*"
            if "bold" in marks:
                s = f"**{s}**"
            parts.append(s)
        elif t == "citation":
            a = n.get("attrs") or {}
            parts.append(in_text_label(a, style, _citation_number(order, a.get("openalexId"))))
        elif t == "mathInline":
            parts.append(f"${(n.get('attrs') or {}).get('latex', '')}$")
    return "".join(parts)


def to_markdown(document: dict, style: str, refs_label: str) -> str:
    content = _prepared_content(document)
    title = document.get("title") or "(untitled)"
    citations = collect_citations(content)
    order = [c.get("openalexId") for c in citations]
    out = [f"# {title}", ""]
    for b in _children(content):
        t = b.get("type")
        if t == "heading":
            lvl = (b.get("attrs") or {}).get("level", 1)
            out.append("#" * min(lvl + 1, 6) + " " + _inline_md(_children(b), style, order))
        elif t in ("bulletList", "orderedList"):
            for i, item in enumerate(_children(b), 1):
                inner = "".join(_inline_md(_children(ch), style, order) for ch in _children(item))
                out.append(("- " if t == "bulletList" else f"{i}. ") + inner)
        elif t == "blockquote":
            for ch in _children(b):
                out.append("> " + _inline_md(_children(ch), style, order))
        elif t == "codeBlock":
            out.append("```\n" + _block_text(b) + "\n```")
        elif t == "horizontalRule":
            out.append("---")
        elif t == "figure":
            a = b.get("attrs") or {}
            out.append(f"![{a.get('caption', '')}]({a.get('src', '')})")
            if a.get("caption"):
                out.append(f"*{a['caption']}*")
        elif t == "mathBlock":
            out.append(f"$$\n{(b.get('attrs') or {}).get('latex', '')}\n$$")
        elif t == "tableBlock":
            cap, rows = _table_parts(b)
            if cap:
                out.append(f"**{cap}**")
            if rows:
                ncols = max(len(r) for r in rows)
                out.append("| " + " | ".join((rows[0] + [""] * ncols)[:ncols]) + " |")
                out.append("| " + " | ".join(["---"] * ncols) + " |")
                for r in rows[1:]:
                    out.append("| " + " | ".join((r + [""] * ncols)[:ncols]) + " |")
        elif t == "tableList":
            continue
        else:
            out.append(_inline_md(_children(b), style, order))
        out.append("")
    if citations:
        out.append(f"## {refs_label}")
        out.append("")
        for i, c in enumerate(citations):
            out.append(f"{i + 1}. {full_reference(c, style, i + 1)}")
    return "\n".join(out).strip() + "\n"


def to_text(document: dict, style: str, refs_label: str) -> str:
    """Strip-to-plain-text: citations as in-text markers, references appended."""
    content = _prepared_content(document)
    title = document.get("title") or "(untitled)"
    citations = collect_citations(content)
    order = [c.get("openalexId") for c in citations]

    def inline(nodes: list[dict]) -> str:
        parts: list[str] = []
        for n in nodes or []:
            t = n.get("type")
            if t == "text":
                parts.append(n.get("text", ""))
            elif t == "citation":
                a = n.get("attrs") or {}
                parts.append(in_text_label(a, style, _citation_number(order, a.get("openalexId"))))
            elif t == "mathInline":
                parts.append(f"${(n.get('attrs') or {}).get('latex', '')}$")
        return "".join(parts)

    out = [title, ""]
    for b in _children(content):
        t = b.get("type")
        if t in ("bulletList", "orderedList"):
            for i, item in enumerate(_children(b), 1):
                inner = "".join(inline(_children(ch)) for ch in _children(item))
                out.append(("- " if t == "bulletList" else f"{i}. ") + inner)
        elif t == "codeBlock":
            out.append(_block_text(b))
        elif t == "figure":
            cap = (b.get("attrs") or {}).get("caption") or ""
            out.append(f"[{('圖: ' + cap) if cap else 'image'}]")
        elif t == "mathBlock":
            out.append(f"${(b.get('attrs') or {}).get('latex', '')}$")
        elif t == "tableBlock":
            cap, rows = _table_parts(b)
            if cap:
                out.append(cap)
            for r in rows:
                out.append("\t".join(r))
        elif t == "tableList":
            continue
        else:
            out.append(inline(_children(b)))
        out.append("")
    if citations:
        out.append(refs_label)
        for i, c in enumerate(citations):
            out.append(f"[{i + 1}] {full_reference(c, style, i + 1)}")
    return "\n".join(out).strip() + "\n"


_HTML_ESCAPE = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}


def _h(s: str) -> str:
    return "".join(_HTML_ESCAPE.get(ch, ch) for ch in (s or ""))


def _inline_html(nodes: list[dict], style: str, order: list[str]) -> str:
    parts: list[str] = []
    for n in nodes or []:
        t = n.get("type")
        if t == "text":
            s = _h(n.get("text", ""))
            marks = {m.get("type") for m in (n.get("marks") or [])}
            if "code" in marks:
                s = f"<code>{s}</code>"
            if "strike" in marks:
                s = f"<s>{s}</s>"
            if "italic" in marks:
                s = f"<em>{s}</em>"
            if "bold" in marks:
                s = f"<strong>{s}</strong>"
            parts.append(s)
        elif t == "citation":
            a = n.get("attrs") or {}
            parts.append(_h(in_text_label(a, style, _citation_number(order, a.get("openalexId")))))
        elif t == "mathInline":
            parts.append("\\(" + (n.get("attrs") or {}).get("latex", "") + "\\)")
    return "".join(parts)


# Academic, paper-like styling: serif body, justified text, numbered refs.
_HTML_CSS = """
:root { color-scheme: light; }
body { font-family: "Noto Serif TC","Noto Serif CJK TC","Songti TC","Times New Roman",Georgia,serif;
  max-width: 760px; margin: 2.5rem auto; padding: 0 1.5rem; line-height: 1.7;
  color: #1a1a1a; background: #fff; text-align: justify; }
h1 { text-align: center; font-size: 1.7rem; margin-bottom: 1.6rem; }
h2 { font-size: 1.3rem; margin-top: 1.8rem; border-bottom: 1px solid #ddd; padding-bottom: .2rem; }
h3 { font-size: 1.1rem; margin-top: 1.4rem; }
figure { text-align: center; margin: 1.4rem 0; }
figure img { max-width: 100%; }
figcaption { font-size: .9rem; color: #555; margin-top: .4rem; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th, td { border: 1px solid #999; padding: .4rem .6rem; }
blockquote { border-left: 3px solid #ccc; margin: 1rem 0; padding-left: 1rem; color: #444; }
pre { background: #f5f5f5; padding: .8rem; overflow-x: auto; font-family: ui-monospace,monospace; }
ol.refs li { margin-bottom: .4rem; }
@media print { body { margin: 0; max-width: none; } }
"""


def to_html(document: dict, style: str, refs_label: str) -> str:
    content = _prepared_content(document)
    title = document.get("title") or "(untitled)"
    citations = collect_citations(content)
    order = [c.get("openalexId") for c in citations]

    parts: list[str] = [f"<h1>{_h(title)}</h1>"]
    for b in _children(content):
        t = b.get("type")
        if t == "heading":
            lvl = min((b.get("attrs") or {}).get("level", 1) + 1, 4)
            parts.append(f"<h{lvl}>{_inline_html(_children(b), style, order)}</h{lvl}>")
        elif t in ("bulletList", "orderedList"):
            tag = "ul" if t == "bulletList" else "ol"
            items = "".join(
                "<li>" + "".join(_inline_html(_children(ch), style, order) for ch in _children(item)) + "</li>"
                for item in _children(b)
            )
            parts.append(f"<{tag}>{items}</{tag}>")
        elif t == "blockquote":
            inner = "".join("<p>" + _inline_html(_children(ch), style, order) + "</p>" for ch in _children(b))
            parts.append(f"<blockquote>{inner}</blockquote>")
        elif t == "codeBlock":
            parts.append(f"<pre><code>{_h(_block_text(b))}</code></pre>")
        elif t == "horizontalRule":
            parts.append("<hr>")
        elif t == "figure":
            a = b.get("attrs") or {}
            cap = f"<figcaption>{_h(a.get('caption', ''))}</figcaption>" if a.get("caption") else ""
            uri = _img_data_uri(a.get("src", ""))
            parts.append(f'<figure><img src="{_h(uri)}" alt="{_h(a.get("caption", ""))}">{cap}</figure>')
        elif t == "mathBlock":
            parts.append("<p>\\[" + (b.get("attrs") or {}).get("latex", "") + "\\]</p>")
        elif t == "tableBlock":
            cap, rows = _table_parts(b)
            head = f"<caption>{_h(cap)}</caption>" if cap else ""
            body = "".join("<tr>" + "".join(f"<td>{_h(c)}</td>" for c in r) + "</tr>" for r in rows)
            parts.append(f"<table>{head}{body}</table>")
        elif t == "tableList":
            continue
        else:
            parts.append(f"<p>{_inline_html(_children(b), style, order)}</p>")
    if citations:
        items = "".join(f"<li>{_h(full_reference(c, style, i + 1))}</li>" for i, c in enumerate(citations))
        parts.append(f'<h2>{_h(refs_label)}</h2><ol class="refs">{items}</ol>')

    mathjax = (
        '<script>window.MathJax={tex:{inlineMath:[["\\\\(","\\\\)"]],displayMath:[["\\\\[","\\\\]"]]}};</script>'
        '<script async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>'
    )
    return (
        "<!doctype html><html lang=\"zh-Hant\"><head><meta charset=\"utf-8\">"
        f"<title>{_h(title)}</title><style>{_HTML_CSS}</style>{mathjax}</head>"
        f"<body>{''.join(parts)}</body></html>"
    )
