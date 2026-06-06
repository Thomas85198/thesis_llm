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
import re
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
# Mild sampling so the model doesn't greedily latch onto a repeated pattern in
# the context (the main repetition guard is _collapse_repeats below; this helps
# at the margin).
TEMPERATURE = 0.4

# Split into sentences, keeping each terminator attached to its sentence. Covers
# both CJK (。！？) and Latin (.!?) punctuation plus hard newlines. The trailing
# alternative captures a final fragment with no terminator (the text right at the
# cursor, mid-sentence).
_SENTENCE = re.compile(r".*?[。．.！？!?\n]+|.+\Z", re.S)


def _norm(sentence: str) -> str:
    """Whitespace-insensitive key for comparing two sentences."""
    return re.sub(r"\s+", "", sentence)


def _collapse_repeats(text: str) -> str:
    """Drop sentences that already appeared earlier in the context tail.

    A degenerate document — most often the autocomplete loop itself, where the
    author keeps accepting the same suggestion — fills the window with one
    sentence repeated many times. The model then mirrors that pattern no matter
    what the prompt says, because in-context repetition is a far stronger signal
    than a single instruction. Keeping only the first occurrence of each distinct
    sentence removes the repetition signal while preserving the author's real
    prose order. The final fragment (the partial sentence at the cursor) is always
    kept so mid-sentence completion still works.
    """
    pieces = _SENTENCE.findall(text)
    if not pieces:
        return text
    seen: set[str] = set()
    out: list[str] = []
    for i, piece in enumerate(pieces):
        is_last = i == len(pieces) - 1
        key = _norm(piece)
        if not is_last and key and key in seen:
            continue
        seen.add(key)
        out.append(piece)
    return "".join(out)


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

    Repetition guard: the context tail is deduped before sending, and the stream
    is buffered per sentence so any sentence that merely echoes the context (or
    one already emitted) is dropped instead of shown — better to suggest nothing
    than to loop the author's own text back at them. A mid-stream LLM failure is
    surfaced as `data: {"error": "..."}` followed by [DONE], so the client always
    sees a clean terminator.
    """
    loc = i18n.normalize_locale(locale)
    context = _collapse_repeats(text_before[-MAX_CONTEXT_CHARS:])
    seen = {_norm(s) for s in _SENTENCE.findall(context) if _norm(s)}
    system = _build_system(title, outline, loc)
    try:
        pending = ""  # buffer holding the in-progress sentence
        stop = False
        for delta in llm.stream_completion(
            model=llm.model_light(),
            system=system,
            user_content=context,
            max_tokens=MAX_OUTPUT_TOKENS,
            temperature=TEMPERATURE,
            paper_id=doc_id,  # logged under llm_calls.paper_id for /api/cost
            stage="autocomplete",
        ):
            pending += delta
            # Flush each completed sentence; hold the trailing partial in `pending`.
            while (m := re.search(r"[。．.！？!?\n]+", pending)) is not None:
                cut = m.end()
                sentence, pending = pending[:cut], pending[cut:]
                key = _norm(sentence)
                if key and key in seen:
                    stop = True  # echoes the context (or a prior line) → cut here
                    break
                seen.add(key)
                yield f"data: {json.dumps({'t': sentence}, ensure_ascii=False)}\n\n"
            if stop:
                break
        # Flush a trailing partial sentence unless it, too, just repeats context.
        if not stop and pending and _norm(pending) not in seen:
            yield f"data: {json.dumps({'t': pending}, ensure_ascii=False)}\n\n"
    except Exception as exc:  # noqa: BLE001 — surface any failure to the client
        yield f"data: {json.dumps({'error': repr(exc)})}\n\n"
    yield "data: [DONE]\n\n"
