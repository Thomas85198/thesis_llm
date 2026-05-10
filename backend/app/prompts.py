"""Centralized prompt loader: read system prompts from backend/prompts/*.md.

Why this exists:
- 學長 can edit prompts without touching Python.
- We can git diff prompt evolution separately from code.
- A bad prompt edit fails fast at import time (FileNotFoundError) rather than
  silently using stale defaults.

Convention:
- One .md per stage, e.g. prompts/checker.md → load_prompt("checker").
- Templates use Python str.format() placeholders: {var_name}.
- Caller is responsible for substituting variables before passing to LLM.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


@lru_cache(maxsize=32)
def load_prompt(name: str) -> str:
    """Read prompts/<name>.md and return its content (cached per process)."""
    path = PROMPTS_DIR / f"{name}.md"
    if not path.exists():
        raise FileNotFoundError(
            f"Prompt file not found: {path}. "
            f"Available: {sorted(p.stem for p in PROMPTS_DIR.glob('*.md'))}"
        )
    return path.read_text(encoding="utf-8").strip()


def reload() -> None:
    """Drop the cache so edits to prompt files take effect without restart."""
    load_prompt.cache_clear()
