"""Editor-mode import: .txt / .md / .docx / .tex → TipTap (ProseMirror) JSON.

The inverse of export_doc.py: parse an uploaded document into the same node tree
the editor renders, so an author can keep writing. Node names and attrs mirror
the frontend extensions exactly (citation/figure/math/table…) — see
components/editor/*. Citations cannot be reconstructed (an export only leaves a
text marker, the OpenAlex metadata is gone), so imported in-text markers stay as
plain text; the author re-inserts live citations where needed.

Each parser returns (title, doc) where doc is {"type": "doc", "content": [...]}.
"""
from __future__ import annotations

import io
import os
import re
import uuid
from pathlib import Path
from typing import Any

import mistune


# ---------- ProseMirror node builders ----------

def _text(s: str, marks: tuple[str, ...] = ()) -> dict | None:
    """An inline text node. None for empty strings (ProseMirror forbids them)."""
    if not s:
        return None
    node: dict[str, Any] = {"type": "text", "text": s}
    if marks:
        seen: list[str] = []
        for m in marks:
            if m not in seen:
                seen.append(m)
        node["marks"] = [{"type": m} for m in seen]
    return node


def _clean(nodes: list[dict | None]) -> list[dict]:
    return [n for n in nodes if n]


def _para(inline: list[dict | None]) -> dict:
    content = _clean(inline)
    return {"type": "paragraph", "content": content} if content else {"type": "paragraph"}


def _heading(level: int, inline: list[dict | None]) -> dict:
    node: dict[str, Any] = {"type": "heading", "attrs": {"level": min(max(int(level), 1), 3)}}
    content = _clean(inline)
    if content:
        node["content"] = content
    return node


def _figure(src: str, caption: str) -> dict:
    return {
        "type": "figure",
        "attrs": {"src": src or "", "caption": caption or "", "alt": caption or ""},
    }


def _code_block(raw: str) -> dict:
    node: dict[str, Any] = {"type": "codeBlock"}
    if raw:
        node["content"] = [{"type": "text", "text": raw}]
    return node


def _table_block(rows: list[list[list[dict | None]]], caption_inline: list[dict | None]) -> dict:
    """rows is a list of rows; each row is a list of cells; each cell is inline
    content. The first row becomes a header row, mirroring the export."""
    trows: list[dict] = []
    for ri, cells in enumerate(rows):
        ctype = "tableHeader" if ri == 0 else "tableCell"
        trows.append({
            "type": "tableRow",
            "content": [{"type": ctype, "content": [_para(c)]} for c in cells],
        })
    if not trows:
        trows = [{"type": "tableRow", "content": [{"type": "tableCell", "content": [{"type": "paragraph"}]}]}]
    cap: dict[str, Any] = {"type": "tableCaption"}
    cap_content = _clean(caption_inline)
    if cap_content:
        cap["content"] = cap_content
    return {"type": "tableBlock", "content": [cap, {"type": "table", "content": trows}]}


def _doc(blocks: list[dict | None]) -> dict:
    content = _clean(blocks)
    if not content:
        content = [{"type": "paragraph"}]
    return {"type": "doc", "content": content}


def _node_text(node: dict) -> str:
    """Flatten all visible text under a ProseMirror node."""
    if node.get("type") == "text":
        return node.get("text", "")
    return "".join(_node_text(c) for c in node.get("content", []))


# ---------- image saving (mirror routes._resolve_upload_dir) ----------

_IMG_EXTS = {"png", "jpg", "jpeg", "gif", "webp"}


def _upload_dir() -> Path:
    explicit = os.getenv("UPLOAD_DIR")
    if explicit:
        return Path(explicit)
    data_dir = os.getenv("DATA_DIR")
    if data_dir:
        return Path(data_dir) / "uploads"
    return Path(__file__).parent.parent / "uploads"


def _save_image(data: bytes, ext: str) -> str:
    """Persist an embedded image to UPLOAD_DIR; return its /api/editor/images path
    (the same scheme the upload endpoint and figure nodes use)."""
    e = (ext or "png").lower()
    if e == "jpeg":
        e = "jpg"
    if e not in _IMG_EXTS:
        e = "png"
    d = _upload_dir()
    d.mkdir(parents=True, exist_ok=True)
    name = f"img_{uuid.uuid4().hex[:12]}.{e}"
    (d / name).write_bytes(data)
    return f"/api/editor/images/{name}"


# ---------- plain text ----------

def from_text(text: str) -> tuple[str, dict]:
    """Blank-line-separated paragraphs; single newlines become hard breaks."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    blocks: list[dict] = []
    for chunk in re.split(r"\n[ \t]*\n", text):
        lines = [ln for ln in chunk.split("\n")]
        if not any(ln.strip() for ln in lines):
            continue
        inline: list[dict | None] = []
        first = True
        for ln in lines:
            if not first:
                inline.append({"type": "hardBreak"})
            first = False
            inline.append(_text(ln))
        blocks.append(_para(inline))
    return "", _doc(blocks)


# ---------- markdown (mistune AST) ----------

def _raw_text(nodes: list[dict] | None) -> str:
    out = ""
    for n in nodes or []:
        if n.get("type") == "text":
            out += n.get("raw", "")
        elif n.get("raw"):
            out += n["raw"]
        elif n.get("children"):
            out += _raw_text(n["children"])
    return out.strip()


def _md_inline(nodes: list[dict] | None, marks: tuple[str, ...] = ()) -> list[dict]:
    out: list[dict | None] = []
    for n in nodes or []:
        t = n.get("type")
        if t == "text":
            out.append(_text(n.get("raw", ""), marks))
        elif t == "strong":
            out += _md_inline(n.get("children"), marks + ("bold",))
        elif t == "emphasis":
            out += _md_inline(n.get("children"), marks + ("italic",))
        elif t == "strikethrough":
            out += _md_inline(n.get("children"), marks + ("strike",))
        elif t == "codespan":
            out.append(_text(n.get("raw", ""), marks + ("code",)))
        elif t == "inline_math":
            out.append({"type": "mathInline", "attrs": {"latex": n.get("raw", "").strip()}})
        elif t == "link":
            out += _md_inline(n.get("children"), marks)  # keep text, drop URL
        elif t == "linebreak":
            out.append({"type": "hardBreak"})
        elif t == "softbreak":
            out.append(_text(" ", marks))
        # image handled at block level
    return _clean(out)


def _md_paragraph_blocks(children: list[dict]) -> list[dict]:
    """A markdown paragraph may embed images; lift each into its own figure
    block, splitting the surrounding text into separate paragraphs."""
    blocks: list[dict] = []
    buf: list[dict] = []
    for n in children:
        if n.get("type") == "image":
            if buf:
                blocks.append(_para(_md_inline(buf)))
                buf = []
            caption = _raw_text(n.get("children")) or (n.get("attrs") or {}).get("alt", "")
            blocks.append(_figure((n.get("attrs") or {}).get("url", ""), caption))
        else:
            buf.append(n)
    if buf:
        blocks.append(_para(_md_inline(buf)))
    return blocks


def _md_list(node: dict) -> dict:
    ordered = bool((node.get("attrs") or {}).get("ordered"))
    items: list[dict] = []
    for li in node.get("children", []):
        content: list[dict] = []
        for ch in li.get("children", []):
            ct = ch.get("type")
            if ct in ("block_text", "paragraph"):
                content.append(_para(_md_inline(ch.get("children"))))
            elif ct == "list":
                content.append(_md_list(ch))  # nested list under the item
        if not content:
            content = [{"type": "paragraph"}]
        items.append({"type": "listItem", "content": content})
    return {"type": "orderedList" if ordered else "bulletList", "content": items}


def _md_table(node: dict) -> dict:
    rows: list[list[list[dict]]] = []
    for section in node.get("children", []):
        st = section.get("type")
        if st == "table_head":
            rows.append([_md_inline(c.get("children")) for c in section.get("children", [])])
        elif st == "table_body":
            for tr in section.get("children", []):
                rows.append([_md_inline(c.get("children")) for c in tr.get("children", [])])
    return _table_block(rows, [])


def _md_blocks(tokens: list[dict]) -> list[dict]:
    out: list[dict] = []
    for n in tokens:
        t = n.get("type")
        if t == "heading":
            out.append(_heading((n.get("attrs") or {}).get("level", 1), _md_inline(n.get("children"))))
        elif t == "paragraph":
            out += _md_paragraph_blocks(n.get("children", []))
        elif t == "list":
            out.append(_md_list(n))
        elif t == "block_quote":
            content = [
                _para(_md_inline(ch.get("children")))
                for ch in n.get("children", [])
                if ch.get("type") == "paragraph"
            ]
            out.append({"type": "blockquote", "content": content or [{"type": "paragraph"}]})
        elif t == "block_code":
            out.append(_code_block(n.get("raw", "").rstrip("\n")))
        elif t == "thematic_break":
            out.append({"type": "horizontalRule"})
        elif t == "block_math":
            out.append({"type": "mathBlock", "attrs": {"latex": n.get("raw", "").strip()}})
        elif t == "table":
            out.append(_md_table(n))
        elif t == "blank_line":
            continue
        elif n.get("children"):
            out += _md_paragraph_blocks(n["children"])
    return out


def from_markdown(text: str) -> tuple[str, dict]:
    md = mistune.create_markdown(renderer=None, plugins=["table", "strikethrough", "math"])
    tokens = md(text.replace("\r\n", "\n"))
    title = ""
    for idx, tk in enumerate(tokens):
        if tk.get("type") == "blank_line":
            continue
        if tk.get("type") == "heading" and (tk.get("attrs") or {}).get("level") == 1:
            title = _raw_text(tk.get("children"))
            tokens = tokens[:idx] + tokens[idx + 1:]
        break
    return title, _doc(_md_blocks(tokens))


# ---------- docx (python-docx) ----------

def _docx_runs(para) -> list[dict]:
    out: list[dict | None] = []
    for run in para.runs:
        s = run.text
        if not s:
            continue
        marks: list[str] = []
        if run.bold:
            marks.append("bold")
        if run.italic:
            marks.append("italic")
        font = run.font
        if font is not None and font.strike:
            marks.append("strike")
        fname = (font.name or "") if font is not None else ""
        if "courier" in fname.lower() or "mono" in fname.lower() or "consolas" in fname.lower():
            marks.append("code")
        out.append(_text(s, tuple(marks)))
    return _clean(out)


def _docx_images(para, doc, qn) -> list[dict]:
    figs: list[dict] = []
    for blip in para._p.findall(".//" + qn("a:blip")):
        rid = blip.get(qn("r:embed")) or blip.get(qn("r:link"))
        if not rid:
            continue
        try:
            part = doc.part.related_parts[rid]
            ct = getattr(part, "content_type", "") or ""
            ext = ct.split("/")[-1].lower() if "/" in ct else "png"
            figs.append(_figure(_save_image(part.blob, ext), ""))
        except Exception:  # noqa: BLE001 — best-effort; skip unreadable images
            continue
    return figs


def _docx_heading_level(style_id: str, name: str) -> int | None:
    for src in (style_id, name):
        m = re.search(r"(?:heading|標題)\s*([1-9])", src, re.I)
        if m:
            return int(m.group(1))
    return None


def _docx_table(table) -> dict:
    rows: list[list[list[dict]]] = []
    for row in table.rows:
        cells: list[list[dict]] = []
        for cell in row.cells:
            txt = cell.text or ""
            cells.append([_text(txt)] if txt else [])
        rows.append(cells)
    return _table_block(rows, [])


def from_docx(raw: bytes) -> tuple[str, dict]:
    from docx import Document
    from docx.oxml.ns import qn
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    doc = Document(io.BytesIO(raw))
    title = ""
    blocks: list[dict] = []
    list_buf: list[dict] = []
    list_ordered: bool | None = None

    def flush_list() -> None:
        nonlocal list_buf, list_ordered
        if list_buf:
            blocks.append({
                "type": "orderedList" if list_ordered else "bulletList",
                "content": list_buf,
            })
            list_buf = []
            list_ordered = None

    for child in doc.element.body.iterchildren():
        if child.tag == qn("w:tbl"):
            flush_list()
            blocks.append(_docx_table(Table(child, doc)))
            continue
        if child.tag != qn("w:p"):
            continue

        para = Paragraph(child, doc)
        style = para.style
        style_id = (style.style_id or "") if style else ""
        name = (style.name or "") if style else ""
        sid_l, name_l = style_id.lower(), name.lower()

        figs = _docx_images(para, doc, qn)
        runs = _docx_runs(para)

        if figs:
            flush_list()
            blocks.extend(figs)
            if runs:  # trailing text in the image paragraph → a caption-ish paragraph
                blocks.append(_para(runs))
            continue

        if "title" in sid_l or name_l in ("title", "標題"):
            flush_list()
            if not title:
                title = "".join(n.get("text", "") for n in runs).strip()
            elif runs:
                blocks.append(_para(runs))
            continue

        level = _docx_heading_level(style_id, name)
        if level is not None:
            flush_list()
            if runs:
                blocks.append(_heading(level, runs))
            continue

        has_numpr = para._p.pPr is not None and para._p.pPr.find(qn("w:numPr")) is not None
        is_list = has_numpr or "list" in sid_l or "list" in name_l or "清單" in name_l
        if is_list:
            ordered = "number" in sid_l or "number" in name_l
            if list_ordered is None:
                list_ordered = ordered
            elif list_ordered != ordered:
                flush_list()
                list_ordered = ordered
            list_buf.append({"type": "listItem", "content": [_para(runs)]})
            continue

        if "quote" in sid_l or "quote" in name_l:
            flush_list()
            blocks.append({"type": "blockquote", "content": [_para(runs)]})
            continue

        flush_list()
        blocks.append(_para(runs))

    flush_list()
    cleaned = _unwrap_pseudo_blockquotes(_demote_pseudo_headings(blocks))
    return title, _doc(_attach_captions(cleaned))


# ---------- latex (pragmatic subset parser) ----------

_TEX_MARK_CMDS = {
    "textbf": "bold", "bfseries": "bold",
    "textit": "italic", "emph": "italic", "itshape": "italic",
    "texttt": "code", "textsf": None, "textrm": None,
    "sout": "strike", "st": "strike",
}
_TEX_DROP_CMDS = {"cite", "citep", "citet", "citeauthor", "label", "ref",
                  "eqref", "footnote", "index", "nocite", "vspace", "hspace"}
_TEX_UNESCAPE = {"&": "&", "%": "%", "$": "$", "#": "#", "_": "_",
                 "{": "{", "}": "}", " ": " "}

_SEC_RE = re.compile(r"\\(section|subsection|subsubsection)\*?\s*\{")
_ENV_RE = re.compile(r"\\begin\{(\w+\*?)\}")


def _brace_arg(s: str, idx: int) -> tuple[str, int]:
    """s[idx] == '{'. Return (inner_text, index_after_matching_close)."""
    depth = 0
    i = idx
    buf = ""
    while i < len(s):
        c = s[i]
        if c == "\\" and i + 1 < len(s):
            buf += s[i:i + 2]
            i += 2
            continue
        if c == "{":
            depth += 1
            if depth == 1:
                i += 1
                continue
        elif c == "}":
            depth -= 1
            if depth == 0:
                return buf, i + 1
        buf += c
        i += 1
    return buf, i


def _strip_tex_comments(s: str) -> str:
    out = []
    for line in s.split("\n"):
        res = ""
        i = 0
        while i < len(line):
            c = line[i]
            if c == "\\" and i + 1 < len(line):
                res += line[i:i + 2]
                i += 2
                continue
            if c == "%":
                break
            res += c
            i += 1
        out.append(res)
    return "\n".join(out)


def _tex_arg_after(s: str, cmd: str) -> str:
    idx = s.find(cmd)
    if idx == -1:
        return ""
    j = s.find("{", idx)
    if j == -1:
        return ""
    arg, _ = _brace_arg(s, j)
    return arg.strip()


def _tex_inline(s: str, marks: tuple[str, ...] = ()) -> list[dict]:
    out: list[dict | None] = []
    i, n = 0, len(s)
    buf = ""

    def flush() -> None:
        nonlocal buf
        if buf:
            out.append(_text(buf, marks))
            buf = ""

    while i < n:
        c = s[i]
        if c == "$":  # inline math $...$
            j = i + 1
            while j < n and s[j] != "$":
                if s[j] == "\\" and j + 1 < n:
                    j += 2
                    continue
                j += 1
            flush()
            out.append({"type": "mathInline", "attrs": {"latex": s[i + 1:j].strip()}})
            i = j + 1 if j < n else n
            continue
        if c == "\\":
            nxt = s[i + 1] if i + 1 < n else ""
            if nxt == "\\":  # line break
                flush()
                out.append({"type": "hardBreak"})
                i += 2
                continue
            if nxt in _TEX_UNESCAPE and not nxt.isalpha():
                buf += _TEX_UNESCAPE[nxt]
                i += 2
                continue
            m = re.match(r"\\([a-zA-Z]+)\*?", s[i:])
            if m:
                name = m.group(1)
                after = i + m.end()
                if name == "textbackslash":
                    buf += "\\"
                    i = after
                    continue
                if name == "textasciitilde":
                    buf += "~"
                    i = after
                    continue
                if name == "textasciicircum":
                    buf += "^"
                    i = after
                    continue
                k = after
                while k < n and s[k] == " ":
                    k += 1
                if k < n and s[k] == "{":
                    arg, after2 = _brace_arg(s, k)
                    if name in _TEX_DROP_CMDS:
                        i = after2
                        continue
                    flush()
                    mark = _TEX_MARK_CMDS.get(name)
                    extra = (mark,) if mark else ()
                    out += _tex_inline(arg, marks + extra)
                    i = after2
                    continue
                i = after  # bare command (\maketitle, switches…) → drop
                continue
            buf += "\\"
            i += 1
            continue
        if c == "~":
            buf += " "
            i += 1
            continue
        buf += c
        i += 1
    flush()
    return _clean(out)


def _tex_tabular_rows(inner: str) -> list[list[list[dict]]]:
    inner = inner.strip()
    if inner.startswith("{"):  # drop the column spec, e.g. {|l|l|}
        _, after = _brace_arg(inner, 0)
        inner = inner[after:]
    for rule in (r"\hline", r"\toprule", r"\midrule", r"\bottomrule"):
        inner = inner.replace(rule, "")
    rows: list[list[list[dict]]] = []
    for raw_row in re.split(r"\\\\", inner):
        if not raw_row.strip():
            continue
        rows.append([_tex_inline(cell.strip()) for cell in raw_row.split("&")])
    return rows


def _tex_env(env: str, inner: str) -> list[dict]:
    e = env.rstrip("*")
    if e in ("itemize", "enumerate"):
        ordered = e == "enumerate"
        items: list[dict] = []
        for part in re.split(r"\\item", inner)[1:]:
            txt = part.strip()
            items.append({"type": "listItem", "content": [_para(_tex_inline(txt))]})
        if not items:
            return []
        return [{"type": "orderedList" if ordered else "bulletList", "content": items}]
    if e in ("quote", "quotation"):
        paras = [p for p in re.split(r"\n[ \t]*\n", inner.strip()) if p.strip()]
        content = [_para(_tex_inline(p)) for p in paras] or [{"type": "paragraph"}]
        return [{"type": "blockquote", "content": content}]
    if e in ("verbatim", "lstlisting"):
        return [_code_block(inner.strip("\n"))]
    if e in ("equation", "displaymath", "align", "math", "eqnarray", "gather", "multline"):
        return [{"type": "mathBlock", "attrs": {"latex": inner.strip()}}]
    if e == "figure":
        cap = _tex_arg_after(inner, r"\caption")
        mg = re.search(r"\\includegraphics(?:\[[^\]]*\])?\{([^}]*)\}", inner)
        fname = mg.group(1) if mg else ""
        caption = cap or (f"[{fname}]" if fname else "")
        return [_figure("", caption)]
    if e == "table":
        cap = _tex_arg_after(inner, r"\caption")
        mt = re.search(r"\\begin\{tabular\}(.*?)\\end\{tabular\}", inner, re.S)
        rows = _tex_tabular_rows(mt.group(1)) if mt else []
        return [_table_block(rows, _tex_inline(cap) if cap else [])]
    if e == "tabular":
        return [_table_block(_tex_tabular_rows(inner), [])]
    if e in ("center", "flushleft", "flushright", "abstract"):
        return _tex_blocks(inner)
    return _tex_blocks(inner)  # unknown env → process its body


def _tex_blocks(body: str) -> list[dict]:
    blocks: list[dict] = []
    para = ""
    i, n = 0, len(body)

    def flush_para() -> None:
        nonlocal para
        txt = para.strip()
        para = ""
        if txt:
            inline = _tex_inline(txt)
            if inline:
                blocks.append(_para(inline))

    while i < n:
        rest = body[i:]
        if rest[:1] == "\n" and rest[1:2] in ("\n", ""):
            flush_para()
            while i < n and body[i] == "\n":
                i += 1
            continue
        menv = _ENV_RE.match(rest)
        if menv:
            flush_para()
            env = menv.group(1)
            end_tag = "\\end{" + env + "}"
            end_idx = body.find(end_tag, i)
            inner = body[i + menv.end():end_idx] if end_idx != -1 else body[i + menv.end():]
            blocks.extend(_tex_env(env, inner))
            i = (end_idx + len(end_tag)) if end_idx != -1 else n
            continue
        msec = _SEC_RE.match(rest)
        if msec:
            flush_para()
            cmd = msec.group(1)
            arg, after = _brace_arg(body, i + msec.end() - 1)
            lvl = {"section": 1, "subsection": 2, "subsubsection": 3}[cmd]
            blocks.append(_heading(lvl, _tex_inline(arg)))
            i = after
            continue
        para += body[i]
        i += 1
    flush_para()
    return blocks


def from_latex(text: str) -> tuple[str, dict]:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _strip_tex_comments(text)
    title = _tex_arg_after(text, r"\title")
    m = re.search(r"\\begin\{document\}(.*)\\end\{document\}", text, re.S)
    body = m.group(1) if m else text
    title_inline = _tex_inline(title) if title else []
    title_str = "".join(n.get("text", "") for n in title_inline).strip()
    return title_str, _doc(_tex_blocks(body))


# ---------- post-processing: heading heuristics + directory re-linking ----------

# A heading ending in sentence punctuation, or this long, reads as body prose —
# many theses apply Heading styles to ordinary paragraphs, so we demote those.
_SENTENCE_END = "。．.！？!?；;："
_PSEUDO_HEADING_LEN = 40


def _demote_pseudo_headings(blocks: list[dict]) -> list[dict]:
    """Demote mis-styled body paragraphs (DOCX) that came in as headings."""
    out: list[dict] = []
    for b in blocks:
        if b.get("type") == "heading":
            s = _node_text(b).strip()
            if len(s) >= _PSEUDO_HEADING_LEN or (s and s[-1] in _SENTENCE_END):
                inline = b.get("content")
                out.append({"type": "paragraph", "content": inline} if inline else {"type": "paragraph"})
                continue
        out.append(b)
    return out


def _unwrap_pseudo_blockquotes(blocks: list[dict]) -> list[dict]:
    """A blockquote reading like body prose or a reference entry (long, or ending
    in sentence punctuation) is a mis-applied Quote style — common for thesis
    bibliographies. Unwrap it to plain paragraphs. Real pull-quotes are short and
    rarely end in a full stop, so they stay quoted."""
    out: list[dict] = []
    for b in blocks:
        if b.get("type") == "blockquote":
            s = _node_text(b).strip()
            if len(s) >= _PSEUDO_HEADING_LEN or (s and s[-1] in _SENTENCE_END):
                inner = [c for c in b.get("content", []) if c.get("type") == "paragraph"]
                out.extend(inner or [{"type": "paragraph"}])
                continue
        out.append(b)
    return out


# Figure/table captions in DOCX live in a separate paragraph (圖 N… below a
# picture, 表 N… above a table). Pull that prose into the node's caption so the
# List of Figures / List of Tables show real titles instead of "(untitled)".
_FIG_CAPTION = re.compile(r"^\s*(?:圖|Figure|Fig\.?)\s*\d+(?:[-－.]\d+)?[：:.\s　]*(.*)$", re.I)
_TBL_CAPTION = re.compile(r"^\s*(?:表|Table)\s*\d+(?:[-－.]\d+)?[：:.\s　]*(.*)$", re.I)


def _caption_of(block: dict, pattern: re.Pattern) -> str | None:
    """If `block` is a caption-style line (圖 1-1 …/表 2-1 …), return the title
    text with the '圖 N'/'表 N' prefix stripped (the node adds its own number).
    Accepts paragraph OR heading — theses often style captions as a heading,
    which also wrongly pollutes the TOC until we fold it into the node here."""
    if block.get("type") not in ("paragraph", "heading"):
        return None
    s = _node_text(block).strip()
    m = pattern.match(s)
    if not m:
        return None
    return m.group(1).strip() or s


def _set_table_caption(block: dict, caption: str) -> dict:
    new = dict(block)
    content = []
    for c in block.get("content", []):
        if c.get("type") == "tableCaption":
            content.append(
                {"type": "tableCaption", "content": [{"type": "text", "text": caption}]}
                if caption else {"type": "tableCaption"}
            )
        else:
            content.append(c)
    new["content"] = content
    return new


def _attach_captions(blocks: list[dict]) -> list[dict]:
    """Fold a figure's following / a table's preceding caption paragraph into the
    node, removing the now-redundant standalone paragraph."""
    out: list[dict] = []
    i, n = 0, len(blocks)
    while i < n:
        b = blocks[i]
        if b.get("type") == "figure" and i + 1 < n:
            cap = _caption_of(blocks[i + 1], _FIG_CAPTION)
            if cap is not None:
                nb = dict(b)
                nb["attrs"] = {**b.get("attrs", {}), "caption": cap, "alt": cap}
                out.append(nb)
                i += 2  # consume the caption paragraph
                continue
        if b.get("type") == "tableBlock" and out:
            cap = _caption_of(out[-1], _TBL_CAPTION)
            if cap is not None:
                out.pop()  # remove the caption paragraph above the table
                out.append(_set_table_caption(b, cap))
                i += 1
                continue
        out.append(b)
        i += 1
    return out


# Directory headings → the live editor node that replaces their (now-stale) body.
# Order matters: 圖目錄/表目錄 contain 目錄, so match them before tableOfContents.
_DIR_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("figureList", ("圖目錄", "圖次", "list of figures", "table of figures")),
    ("tableList", ("表目錄", "表次", "list of tables")),
    ("tableOfContents", ("目錄", "目次", "table of contents", "contents")),
)


def _directory_node_for(block: dict) -> str | None:
    if block.get("type") != "heading":
        return None
    s = _node_text(block).strip().lower()
    if not s or len(s) > 16:
        return None
    for node_type, kws in _DIR_KEYWORDS:
        if any(k in s for k in kws):
            return node_type
    return None


def _is_directory_debris(block: dict) -> bool:
    """A leftover TOC entry: an empty paragraph, a tab-leadered line, or a line
    ending in leader dots + a page number. These are what a Word TOC field
    degrades into on import — safe to drop in favour of a live directory node."""
    if block.get("type") != "paragraph":
        return False
    raw = _node_text(block)
    if not raw.strip():
        return True
    if "\t" in raw:
        return True
    return bool(re.search(r"[.…]{2,}\s*\d+$", raw.strip()))


def _relink_directories(blocks: list[dict]) -> list[dict]:
    """Replace each 目錄/圖目錄/表目錄 heading's stale body with a live node."""
    out: list[dict] = []
    i, n = 0, len(blocks)
    while i < n:
        b = blocks[i]
        node_type = _directory_node_for(b)
        if node_type:
            out.append(b)  # keep the heading
            j = i + 1
            while j < n and _is_directory_debris(blocks[j]):
                j += 1
            out.append({"type": node_type})
            i = j
            continue
        out.append(b)
        i += 1
    return out


# ---------- dispatch ----------

SUPPORTED_EXTS = {"txt", "text", "md", "markdown", "mdown", "docx", "tex", "latex"}


def to_prosemirror(filename: str, raw: bytes) -> tuple[str, dict]:
    """Dispatch by file extension. Returns (title, prosemirror_doc). Title falls
    back to the filename stem when the document carries none."""
    ext = Path(filename or "").suffix.lower().lstrip(".")
    if ext in ("txt", "text"):
        title, doc = from_text(raw.decode("utf-8", "replace"))
    elif ext in ("md", "markdown", "mdown"):
        title, doc = from_markdown(raw.decode("utf-8", "replace"))
    elif ext == "docx":
        title, doc = from_docx(raw)
    elif ext in ("tex", "latex"):
        title, doc = from_latex(raw.decode("utf-8", "replace"))
    else:
        raise ValueError(f"unsupported import type: .{ext or '?'}")
    doc["content"] = _relink_directories(doc.get("content") or [])
    if not doc["content"]:
        doc["content"] = [{"type": "paragraph"}]
    if not title:
        title = Path(filename or "").stem or "未命名文件"
    return title[:300], doc
