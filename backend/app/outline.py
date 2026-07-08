"""Editor-mode outline generation: turn a topic into a thesis heading tree.

A single forced-tool call (like citation.to_search_query) that returns a list of
{level, text} headings the editor inserts as heading nodes. The fixed IMRaD
template is handled client-side (no model needed); this module only powers the
"Smart Headings from a topic" path.
"""
from __future__ import annotations

import threading

from . import i18n, llm, ratelimit
from .prompts import load_prompt

# Outline generation is a rare, explicit click (a button), but still capped per
# document as a backstop against a stuck/abusive client.
RATE_LIMIT_PER_MIN = 10  # per doc_id
MAX_TOPIC_CHARS = 500
MAX_HEADINGS = 30  # trim pathological model output

_OUTLINE_SCHEMA = {
    "type": "object",
    "properties": {
        "headings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "level": {"type": "integer"},  # 1=section, 2=subsection, 3=…
                    "text": {"type": "string"},
                },
                "required": ["level", "text"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["headings"],
    "additionalProperties": False,
}


_rate_lock = threading.Lock()
_rate_buckets: dict[str, list[float]] = {}


def check_rate_limit(doc_id: str) -> tuple[bool, int]:
    """Return (allowed, seconds_until_next_slot). Sliding 60s window per doc."""
    return ratelimit.check(_rate_buckets, _rate_lock, RATE_LIMIT_PER_MIN, doc_id)


def _clean(headings: list[dict]) -> list[dict]:
    """Keep well-formed headings, clamp level to 1–3, drop blanks, cap count."""
    out: list[dict] = []
    for h in headings:
        text = str(h.get("text", "")).strip()
        if not text:
            continue
        level = h.get("level", 1)
        level = level if isinstance(level, int) else 1
        out.append({"level": max(1, min(3, level)), "text": text})
        if len(out) >= MAX_HEADINGS:
            break
    return out


def generate(topic: str, doc_id: str, locale: str | None) -> list[dict]:
    """Generate a thesis outline (heading tree) for `topic` in the doc's language.

    Returns a list of {level, text}. Raises whatever llm.call_with_tool raises
    (the route maps failures to a 502); an empty topic returns [] without a call.
    """
    topic = topic.strip()[:MAX_TOPIC_CHARS]
    if not topic:
        return []
    loc = i18n.normalize_locale(locale)
    system = load_prompt("outline").format(language=i18n.LANG_NAME[loc])
    result = llm.call_with_tool(
        model=llm.model_light(),
        system=system,
        user_content=topic,
        tool_name="outline",
        tool_description="Provide a structured thesis outline as a list of headings.",
        tool_input_schema=_OUTLINE_SCHEMA,
        max_tokens=1500,
        paper_id=doc_id,
        stage="outline",
    )
    return _clean(result.get("headings") or [])
