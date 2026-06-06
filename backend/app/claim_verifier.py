"""Smart Citation claim–evidence verification (the "traffic light").

Given a claim sentence and a candidate source's abstract, an LLM judges whether
the source actually supports the claim — 🟢 supports / 🟡 partial / 🔴 unsupported
— and surfaces the supporting sentence. This attacks the well-known weakness of
keyword-only citation tools (a result that matches keywords but doesn't actually
back the claim). No vector store needed: the abstract already rides home in the
OpenAlex candidate; we verify with a single forced-tool LLM call.
"""
from __future__ import annotations

import threading
import time

from . import i18n, llm
from .prompts import load_prompt

RATE_LIMIT_PER_MIN = 40  # per doc_id — verify is a per-candidate click
MAX_CLAIM_CHARS = 2000
MAX_ABSTRACT_CHARS = 8000

_VERDICT_SCHEMA = {
    "type": "object",
    "properties": {
        # supports = abstract clearly backs the claim; partial = related but
        # doesn't fully back it; unsupported = off-topic or contradicts.
        "verdict": {"type": "string", "enum": ["supports", "partial", "unsupported"]},
        "evidence": {"type": "string"},  # the supporting sentence from the abstract ("" if none)
        "reason": {"type": "string"},    # one short sentence
        "confidence": {"type": "number"},
    },
    "required": ["verdict", "evidence", "reason", "confidence"],
    "additionalProperties": False,
}


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


def verify(claim: str, title: str, abstract: str, doc_id: str, locale: str | None) -> dict:
    """Judge whether `abstract` supports `claim`. Returns a verdict dict.

    Degrades gracefully: an empty abstract (the source has none) returns
    verdict "unknown" without an LLM call — we can't verify what we can't read.
    """
    claim = claim.strip()[:MAX_CLAIM_CHARS]
    abstract = (abstract or "").strip()[:MAX_ABSTRACT_CHARS]
    if not claim:
        return {"verdict": "unknown", "evidence": "", "reason": "no claim", "confidence": 0.0}
    if not abstract:
        return {"verdict": "unknown", "evidence": "", "reason": "no abstract", "confidence": 0.0}

    loc = i18n.normalize_locale(locale)
    system = load_prompt("claim_verifier").format(language=i18n.LANG_NAME[loc])
    user_content = f"Claim:\n{claim}\n\nSource title:\n{title.strip()}\n\nSource abstract:\n{abstract}"
    result = llm.call_with_tool(
        model=llm.model_light(),
        system=system,
        user_content=user_content,
        tool_name="verdict",
        tool_description="Judge whether the source abstract supports the claim.",
        tool_input_schema=_VERDICT_SCHEMA,
        max_tokens=600,
        paper_id=doc_id,
        stage="claim_verify",
    )
    return result
