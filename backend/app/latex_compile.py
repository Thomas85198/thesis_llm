"""Server-side XeLaTeX compilation for the one-click thesis-grade PDF export.

Takes the .tex + figures produced by export_doc.to_latex, compiles them in a
throwaway directory and returns the PDF bytes. One xelatex pass is enough: the
generated documents have no cross-references or table of contents.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

_TIMEOUT_S = 60
_LOG_TAIL_LINES = 40


class LatexNotInstalled(RuntimeError):
    """xelatex is not on PATH (e.g. backend running outside the Docker image)."""


class LatexCompileError(RuntimeError):
    """Compilation failed; str(exc) carries the tail of main.log."""


def _log_tail(workdir: Path) -> str:
    log = workdir / "main.log"
    if not log.exists():
        return "(no main.log produced)"
    lines = log.read_text(errors="replace").splitlines()
    return "\n".join(lines[-_LOG_TAIL_LINES:])


def compile_pdf(tex: str, images: list[tuple[str, bytes]]) -> bytes:
    """Compile `tex` (with its referenced figure files) to PDF bytes."""
    if shutil.which("xelatex") is None:
        raise LatexNotInstalled(
            "xelatex not found — PDF export needs the TeX packages baked into "
            "the backend Docker image (see backend/Dockerfile)."
        )
    with tempfile.TemporaryDirectory(prefix="texpdf-") as tmp:
        workdir = Path(tmp)
        (workdir / "main.tex").write_text(tex, encoding="utf-8")
        for fname, fdata in images:
            (workdir / fname).write_bytes(fdata)
        try:
            # User content reaches TeX unescaped by design (math/code nodes), so
            # sandbox the engine: -no-shell-escape blocks \write18, and
            # openin_any/openout_any=p ("paranoid") stop \input / \openin from
            # reading files outside the workdir — otherwise a crafted math node
            # could pull /app/.env (OPENAI_API_KEY) into the returned PDF.
            proc = subprocess.run(
                [
                    "xelatex",
                    "-no-shell-escape",
                    "-interaction=nonstopmode",
                    "-halt-on-error",
                    "main.tex",
                ],
                cwd=workdir,
                capture_output=True,
                timeout=_TIMEOUT_S,
                env={**os.environ, "openin_any": "p", "openout_any": "p"},
            )
        except subprocess.TimeoutExpired as e:
            raise LatexCompileError(f"xelatex timed out after {_TIMEOUT_S}s") from e
        pdf = workdir / "main.pdf"
        if proc.returncode != 0 or not pdf.exists():
            raise LatexCompileError(_log_tail(workdir))
        return pdf.read_bytes()
