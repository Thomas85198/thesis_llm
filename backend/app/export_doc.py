"""Editor-mode export: TipTap (ProseMirror) JSON → .docx / .tex.

Walks the stored document tree and renders block/inline nodes, including the
custom inline `citation` atom, into Word and LaTeX. In-text citation markers and
the trailing reference list mirror frontend/lib/citation-format.ts so an export
reads exactly like what the author sees on screen.
"""
from __future__ import annotations

import io
from typing import Any

from docx import Document


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
        # Image embedding is a later export slice; for now keep the caption text
        # (clearly marked) so nothing is silently lost.
        cap = (block.get("attrs") or {}).get("caption") or ""
        p = docx.add_paragraph()
        p.add_run(f"[{cap or 'image'}]").italic = True
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


def to_docx(document: dict, style: str, refs_label: str) -> bytes:
    content = document.get("content_json") or {}
    title = document.get("title") or "(untitled)"
    citations = collect_citations(content)
    order = [c.get("openalexId") for c in citations]

    docx = Document()
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


def _render_block_latex(block: dict, style: str, order: list[str]) -> str:
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
        cap = (block.get("attrs") or {}).get("caption") or ""
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


def to_latex(document: dict, style: str, refs_label: str) -> str:
    content = document.get("content_json") or {}
    title = document.get("title") or "(untitled)"
    citations = collect_citations(content)
    order = [c.get("openalexId") for c in citations]

    body = "".join(_render_block_latex(b, style, order) for b in _children(content))
    refs = ""
    if citations:
        items = "\n".join(
            f"  \\item {_esc(full_reference(c, style, i + 1))}"
            for i, c in enumerate(citations)
        )
        refs = f"\\section*{{{_esc(refs_label)}}}\n\\begin{{itemize}}\n{items}\n\\end{{itemize}}\n\n"

    # ctex makes CJK compile under XeLaTeX/pdfLaTeX; ulem for \sout, hyperref for links.
    return (
        "\\documentclass{article}\n"
        "\\usepackage{ctex}\n"
        "\\usepackage[normalem]{ulem}\n"
        "\\usepackage{hyperref}\n"
        f"\\title{{{_esc(title)}}}\n"
        "\\author{}\n\\date{}\n"
        "\\begin{document}\n\\maketitle\n\n"
        + body
        + refs
        + "\\end{document}\n"
    )
