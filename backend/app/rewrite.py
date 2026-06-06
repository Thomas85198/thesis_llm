"""Editor-mode AI rewrite: stream a rewritten version of a selected passage.

Mirrors autocomplete.py (in-memory per-doc rate limit + SSE shape), but instead
of continuing the text it transforms the author's *selected* text per a preset or
custom instruction (paraphrase, simplify, expand, …). The route wraps sse_stream
in a StreamingResponse exactly like autocomplete.
"""
from __future__ import annotations

import json
import threading
import time
from typing import Iterator

from . import i18n, llm
from .prompts import load_prompt

# Rewrite fires on an explicit click (a selection → menu), far rarer than
# autocomplete, but still capped per document as a backstop against a stuck client.
RATE_LIMIT_PER_MIN = 30  # per doc_id
MAX_TEXT_CHARS = 4000    # of selected text accepted
MAX_OUTPUT_TOKENS = 600  # "expand" can run long; still bounded

# Preset instruction → the directive handed to the model. The key is what the
# client sends; anything not in this table is treated as a free-form custom
# instruction typed by the author.
PRESETS: dict[str, str] = {
    "paraphrase": "Paraphrase the text: keep the meaning but use different wording.",
    "simplify": "Rewrite the text more simply and clearly, in plain language.",
    "expand": "Expand the text with more detail and explanation, staying strictly on topic.",
    "shorten": "Make the text more concise without losing essential meaning.",
    "improve_fluency": "Improve the fluency, grammar, and flow while preserving meaning.",
    "academic": "Rewrite the text in a formal academic register suitable for a thesis.",
    "fix_grammar": "Fix grammar, spelling, and punctuation only; keep the wording otherwise.",
}


def resolve_instruction(instruction: str) -> str:
    """Map a preset key to its directive, or pass a custom instruction through."""
    key = instruction.strip()
    return PRESETS.get(key, key)


_rate_lock = threading.Lock()
_rate_buckets: dict[str, list[float]] = {}


def check_rate_limit(doc_id: str) -> tuple[bool, int]:
    """Return (allowed, seconds_until_next_slot). Sliding 60s window per doc.

    Same shape as autocomplete.check_rate_limit — kept separate so rewrite and
    autocomplete have independent buckets and ceilings.
    """
    now = time.time()
    window = 60.0
    with _rate_lock:
        bucket = [t for t in _rate_buckets.get(doc_id, []) if now - t < window]
        if len(bucket) >= RATE_LIMIT_PER_MIN:
            wait = max(1, int(window - (now - min(bucket))))
            _rate_buckets[doc_id] = bucket
            return False, wait
        bucket.append(now)
        _rate_buckets[doc_id] = bucket
    return True, 0


def _build_system(instruction: str, locale: str) -> str:
    return load_prompt("rewrite").format(
        instruction=resolve_instruction(instruction),
        language=i18n.LANG_NAME[locale],
    )


def sse_stream(
    *, doc_id: str, text: str, instruction: str, locale: str | None
) -> Iterator[str]:
    """Yield Server-Sent Events: `data: {"t": "<delta>"}` per token, then [DONE].

    A mid-stream LLM failure is surfaced as `data: {"error": "..."}` followed by
    [DONE], so the client always sees a clean terminator.
    """
    loc = i18n.normalize_locale(locale)
    selected = text[:MAX_TEXT_CHARS]
    system = _build_system(instruction, loc)
    try:
        for delta in llm.stream_completion(
            model=llm.model_light(),
            system=system,
            user_content=selected,
            max_tokens=MAX_OUTPUT_TOKENS,
            paper_id=doc_id,  # logged under llm_calls.paper_id for /api/cost
            stage="rewrite",
        ):
            yield f"data: {json.dumps({'t': delta}, ensure_ascii=False)}\n\n"
    except Exception as exc:  # noqa: BLE001 — surface any failure to the client
        yield f"data: {json.dumps({'error': repr(exc)})}\n\n"
    yield "data: [DONE]\n\n"
