"""Editor-mode AI autocomplete: stream a short continuation of the author's text.

Mirrors chat.py's shape (in-memory rate limit + prompt assembly), but the output
is free-form text streamed token-by-token via llm.stream_completion, not a
structured tool call. The route wraps sse_stream() in a StreamingResponse.

Guardrails:
- Per-document in-memory rate limit (autocomplete fires far more often than chat).
- Hard cap on how much preceding text we send (cost + latency control).
- Short output cap so suggestions stay snappy and cheap.
"""
from __future__ import annotations

import json
import threading
import time
from typing import Iterator

from . import i18n, llm
from .prompts import load_prompt

# Autocomplete is high-frequency (one call per typing pause), so the ceiling is
# higher than chat's 15/min. The frontend debounce + in-flight cancellation keep
# the real rate well below this; the bucket is a backstop against a stuck client.
RATE_LIMIT_PER_MIN = 60  # per doc_id
MAX_CONTEXT_CHARS = 2000  # of text-before-cursor sent to the model
MAX_OUTPUT_TOKENS = 200   # suggestions are at most a sentence or two


_rate_lock = threading.Lock()
_rate_buckets: dict[str, list[float]] = {}


def check_rate_limit(doc_id: str) -> tuple[bool, int]:
    """Return (allowed, seconds_until_next_slot). Sliding 60s window per doc."""
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


def _build_system(title: str, outline: str, locale: str) -> str:
    return load_prompt("autocomplete").format(
        language=i18n.LANG_NAME[locale],
        title=title.strip() or "(untitled)",
        outline=outline.strip() or "(none)",
    )


def sse_stream(
    *,
    doc_id: str,
    text_before: str,
    title: str,
    outline: str,
    locale: str | None,
) -> Iterator[str]:
    """Yield Server-Sent Events: `data: {"t": "<delta>"}` per token, then [DONE].

    A mid-stream LLM failure is surfaced as `data: {"error": "..."}` followed by
    [DONE], so the client always sees a clean terminator.
    """
    loc = i18n.normalize_locale(locale)
    context = text_before[-MAX_CONTEXT_CHARS:]
    system = _build_system(title, outline, loc)
    try:
        for delta in llm.stream_completion(
            model=llm.model_light(),
            system=system,
            user_content=context,
            max_tokens=MAX_OUTPUT_TOKENS,
            paper_id=doc_id,  # logged under llm_calls.paper_id for /api/cost
            stage="autocomplete",
        ):
            yield f"data: {json.dumps({'t': delta}, ensure_ascii=False)}\n\n"
    except Exception as exc:  # noqa: BLE001 — surface any failure to the client
        yield f"data: {json.dumps({'error': repr(exc)})}\n\n"
    yield "data: [DONE]\n\n"
