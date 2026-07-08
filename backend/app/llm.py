"""OpenAI API wrapper with structured tool-use output, cost logging, retry.

Migrated from Anthropic in feat/openai-deploy. Key differences vs the old wrapper:
- Anthropic tool_use → OpenAI function calling (tool args come back as JSON string).
- Anthropic explicit cache_control → OpenAI automatic prompt caching (≥1024 tokens).
- Token usage: OpenAI's prompt_tokens INCLUDES the cached portion, so we split
  cached_tokens out of input_tokens before logging, to keep cost math consistent.
"""

from __future__ import annotations

import json
import os
import random
import threading
import time
from typing import Any, Iterator

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    InternalServerError,
    OpenAI,
    RateLimitError,
)

from . import db

_client: OpenAI | None = None
_client_lock = threading.Lock()

# Transient errors worth retrying with exponential backoff.
# 5xx = OpenAI-side issue; 429 = rate limit; connection/timeout = network blip.
RETRYABLE_ERRORS = (
    InternalServerError,  # 5xx
    APIConnectionError,  # network
    APITimeoutError,  # timeout
    RateLimitError,  # 429
)
MAX_RETRIES = 4  # total attempts = MAX_RETRIES + 1


class LLMOutputTruncatedError(RuntimeError):
    """The model hit max_completion_tokens mid-output (finish_reason="length").

    On the forced-tool path this means the arguments JSON is incomplete —
    retrying the same input deterministically truncates again (temperature 0),
    so callers must shrink the input (chunk the section) instead of retrying.
    """


def _is_permanent_quota_error(exc: Exception) -> bool:
    """insufficient_quota / billing-limit comes back as a 429 RateLimitError but
    will NEVER succeed on retry. Detect it so we fail fast instead of burning the
    whole backoff sequence (~20s) on a dead account — matters most for the high-
    frequency autocomplete path."""
    code = getattr(exc, "code", None)
    if code in ("insufficient_quota", "billing_hard_limit_reached"):
        return True
    return "insufficient_quota" in str(getattr(exc, "message", "") or exc)


def client() -> OpenAI:
    # Double-checked locking: the fast path is a lockless read once initialized
    # (zero overhead in steady state); the lock only guards the one-time cold
    # init so concurrent worker threads (section/rule fan-out) can't each build
    # a separate client.
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                # OPENAI_BASE_URL supports Azure / lab self-hosted proxies / vLLM.
                # SDK retries are OFF: call_with_tool has its own stage-aware
                # retry with backoff, and the two layers used to multiply
                # (2 SDK × 5 outer = up to 15 requests per sustained 429).
                kwargs: dict[str, Any] = {"max_retries": 0}
                base = os.getenv("OPENAI_BASE_URL")
                if base:
                    kwargs["base_url"] = base
                _client = OpenAI(**kwargs)
    return _client


def model_heavy() -> str:
    return os.getenv("OPENAI_MODEL_HEAVY", "gpt-5.4")


def model_light() -> str:
    return os.getenv("OPENAI_MODEL_LIGHT", "gpt-5.4-mini")


def model_cross_section() -> str:
    # Cross-section pass needs long context to fit the whole paper.
    return os.getenv("OPENAI_MODEL_CROSS_SECTION", "gpt-5.4")


def model_embed() -> str:
    return os.getenv("OPENAI_MODEL_EMBED", "text-embedding-3-small")


def retry_transient(fn: Any, attempts: int = 3, base_delay: float = 2.0) -> Any:
    """Run fn(), retrying RETRYABLE_ERRORS with exponential backoff.

    For call sites that don't go through call_with_tool (embed, chat) — the SDK
    client has max_retries=0, so without this a single 429/5xx surfaces to the
    caller.
    """
    last_exc: Exception | None = None
    for attempt in range(attempts):
        try:
            return fn()
        except RETRYABLE_ERRORS as exc:
            if is_quota_exhausted(exc):
                raise
            last_exc = exc
            if attempt < attempts - 1:
                time.sleep(base_delay * (2**attempt))
    raise last_exc  # type: ignore[misc]


def embed(texts: list[str]) -> list[list[float]]:
    """Return an embedding vector per input text (OpenAI embeddings).

    Used for semantic re-ranking / grounding. Empty input → []. Raises on
    network/API failure; callers that want graceful degradation should catch.
    """
    items = [t if t and t.strip() else " " for t in texts]
    if not items:
        return []
    resp = retry_transient(
        lambda: client().embeddings.create(model=model_embed(), input=items)
    )
    return [d.embedding for d in resp.data]


def llm_temperature() -> float:
    # Defect detection wants reproducible verdicts, not creative variety —
    # default to 0 (greedy decoding). Override via env for experiments.
    try:
        return float(os.getenv("LLM_TEMPERATURE", "0"))
    except ValueError:
        return 0.0


def llm_max_workers() -> int:
    """Thread-pool size for fanning out independent LLM calls (sections, rules).

    The pipeline makes ~30-40 LLM calls that are mostly independent; running
    them concurrently is the main latency win. Bounded to avoid hammering the
    OpenAI rate limit — call_with_tool already retries 429s with backoff, but a
    smaller pool wastes fewer retries. Default 6; raise via OPENAI_MAX_WORKERS
    on a higher tier, drop to 1 to force the old sequential behaviour.
    """
    try:
        return max(1, int(os.getenv("OPENAI_MAX_WORKERS", "6")))
    except ValueError:
        return 6


# OpenAI list pricing (USD per 1M tokens). Approximate; updated 2026-05.
# Each entry: (input, output, cached_input). OpenAI charges no cache-write fee.
PRICING: dict[str, tuple[float, float, float]] = {
    "gpt-5.5": (5.00, 30.00, 0.50),
    "gpt-5.4": (2.50, 15.00, 0.25),
    "gpt-5.4-mini": (0.75, 4.50, 0.075),
    "gpt-5.4-nano": (0.20, 1.25, 0.02),
    "gpt-4.1": (2.00, 8.00, 0.50),
    "gpt-4.1-mini": (0.40, 1.60, 0.10),
    "gpt-4.1-nano": (0.10, 0.40, 0.025),
    "gpt-4o": (2.50, 10.00, 1.25),
    "gpt-4o-mini": (0.15, 0.60, 0.075),
    "o1": (15.00, 60.00, 7.50),
    "o3-mini": (1.10, 4.40, 0.55),
}


def _price(model: str) -> tuple[float, float, float]:
    base = model.split("[", 1)[0]
    return PRICING.get(base) or PRICING.get(model) or (0.0, 0.0, 0.0)


def calc_cost_usd(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> float:
    """Compute USD cost. cache_write_tokens is accepted for DB-schema compat
    but always 0 on OpenAI (no cache-write fee)."""
    in_p, out_p, cr_p = _price(model)
    return (
        input_tokens * in_p + output_tokens * out_p + cache_read_tokens * cr_p
    ) / 1_000_000


def _extract_usage(response: Any) -> tuple[int, int, int, int]:
    """Parse OpenAI usage into (input_excl_cache, output, cache_read, cache_write).

    OpenAI's prompt_tokens INCLUDES cached tokens, so we subtract cached_tokens
    to get the truly-billed-as-fresh input count.
    """
    usage = response.usage
    prompt_tok = getattr(usage, "prompt_tokens", 0) or 0
    out_tok = getattr(usage, "completion_tokens", 0) or 0
    details = getattr(usage, "prompt_tokens_details", None)
    cr_tok = (getattr(details, "cached_tokens", 0) or 0) if details else 0
    in_tok = max(prompt_tok - cr_tok, 0)
    return in_tok, out_tok, cr_tok, 0


def call_with_tool(
    *,
    model: str,
    system: str,
    user_content: str,
    tool_name: str,
    tool_description: str,
    tool_input_schema: dict[str, Any],
    cache_system: bool = True,  # kept for signature compat; OpenAI auto-caches.
    # gpt-5.x supports large outputs; a token-dense zh paper section can emit
    # thousands of EDU tokens. This is a cap, not a reservation — you only pay
    # for what's actually generated, so keep it generous to avoid truncation.
    max_tokens: int = 32000,
    paper_id: str | None = None,
    stage: str = "unspecified",
) -> dict[str, Any]:
    """Call OpenAI with a single forced function tool — returns the parsed args dict.

    System prompt is auto-cached by OpenAI when ≥1024 tokens. Token usage is logged
    to SQLite via db.log_llm_call so /api/cost endpoints can summarize spending.
    """
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_content},
    ]
    tools = [
        {
            "type": "function",
            "function": {
                "name": tool_name,
                "description": tool_description,
                "parameters": tool_input_schema,
            },
        }
    ]

    # Retry transient 5xx / rate-limit / network errors with exponential backoff +
    # jitter. Final failure re-raises so the pipeline fails loudly.
    last_exc: Exception | None = None
    response = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            response = client().chat.completions.create(
                model=model,
                temperature=llm_temperature(),
                max_completion_tokens=max_tokens,
                messages=messages,
                tools=tools,
                tool_choice={"type": "function", "function": {"name": tool_name}},
            )
            break  # success
        except RETRYABLE_ERRORS as exc:
            last_exc = exc
            if _is_permanent_quota_error(exc):
                print(f"[llm] insufficient_quota on stage={stage} — not retrying")
                raise
            if attempt == MAX_RETRIES:
                print(
                    f"[llm] {type(exc).__name__} on stage={stage} model={model} "
                    f"after {MAX_RETRIES + 1} attempts — giving up: {exc!r}"
                )
                raise
            backoff = (1.5 * (2**attempt)) + random.uniform(0, 0.5)
            print(
                f"[llm] {type(exc).__name__} on stage={stage} model={model} "
                f"attempt {attempt + 1}/{MAX_RETRIES + 1} — retrying in {backoff:.1f}s"
            )
            time.sleep(backoff)
        except APIStatusError as exc:
            # 4xx other than 429 (bad request, auth, etc.) — don't retry, fail fast.
            print(
                f"[llm] {type(exc).__name__} (status={exc.status_code}) on stage={stage} "
                f"— non-retryable: {exc!r}"
            )
            raise

    if response is None:
        raise RuntimeError(f"LLM call failed without exception: {last_exc!r}")

    in_tok, out_tok, cr_tok, cw_tok = _extract_usage(response)
    cost = calc_cost_usd(model, in_tok, out_tok, cr_tok, cw_tok)
    try:
        db.log_llm_call(
            paper_id=paper_id,
            stage=stage,
            model=model,
            input_tokens=in_tok,
            output_tokens=out_tok,
            cache_read_tokens=cr_tok,
            cache_write_tokens=cw_tok,
            cost_usd=cost,
        )
    except Exception:
        # Logging must never block the analysis pipeline.
        pass

    choice = response.choices[0]
    # finish_reason="length" → output hit max_completion_tokens and the tool
    # arguments are cut mid-JSON (or, worse, happen to still parse but are
    # incomplete). Either way the result is unusable; raise the dedicated
    # error so callers can shrink the input rather than show a raw JSON blob.
    if choice.finish_reason == "length":
        raise LLMOutputTruncatedError(
            f"LLM output hit the {max_tokens}-token cap on stage={stage} "
            f"(model={model}, output_tokens={out_tok}) — input too large for "
            f"one call; the caller should split it into smaller chunks."
        )
    tool_calls = choice.message.tool_calls or []
    for tc in tool_calls:
        if tc.function.name == tool_name:
            try:
                return json.loads(tc.function.arguments)
            except json.JSONDecodeError as exc:
                raise RuntimeError(
                    f"OpenAI returned invalid JSON for {tool_name}: "
                    f"{tc.function.arguments[:500]}"
                ) from exc

    raise RuntimeError(
        f"OpenAI did not return tool_call for {tool_name}. "
        f"finish_reason={choice.finish_reason} content={choice.message.content!r}"
    )


def stream_completion(
    *,
    model: str,
    system: str,
    user_content: str,
    max_tokens: int = 256,
    temperature: float | None = None,
    paper_id: str | None = None,
    stage: str = "unspecified",
) -> Iterator[str]:
    """Stream a free-form text completion, yielding content deltas as they arrive.

    The counterpart to call_with_tool: that one forces a function call and returns
    a parsed dict synchronously; this one is for open-ended generation (e.g. the
    editor's autocomplete) where we want tokens to flow to the UI immediately.

    Cost is logged once at the end — OpenAI emits a final usage-only chunk when
    stream_options.include_usage is set. We retry only opening the stream (same
    transient-error policy as call_with_tool); once tokens start flowing a mid-
    stream drop just ends the suggestion rather than restarting it.
    """
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_content},
    ]
    temp = llm_temperature() if temperature is None else temperature

    last_exc: Exception | None = None
    stream = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            stream = client().chat.completions.create(
                model=model,
                temperature=temp,
                max_completion_tokens=max_tokens,
                messages=messages,
                stream=True,
                stream_options={"include_usage": True},
            )
            break
        except RETRYABLE_ERRORS as exc:
            last_exc = exc
            if _is_permanent_quota_error(exc):
                print(
                    f"[llm] insufficient_quota opening stream on stage={stage} — not retrying"
                )
                raise
            if attempt == MAX_RETRIES:
                print(
                    f"[llm] {type(exc).__name__} opening stream on stage={stage} "
                    f"model={model} after {MAX_RETRIES + 1} attempts — giving up: {exc!r}"
                )
                raise
            time.sleep((1.5 * (2**attempt)) + random.uniform(0, 0.5))
        except APIStatusError as exc:
            print(
                f"[llm] {type(exc).__name__} (status={exc.status_code}) opening stream "
                f"on stage={stage} — non-retryable: {exc!r}"
            )
            raise

    if stream is None:
        raise RuntimeError(f"stream open failed without exception: {last_exc!r}")

    usage = None
    for chunk in stream:
        # The trailing usage-only chunk carries no choices.
        if getattr(chunk, "usage", None) is not None:
            usage = chunk.usage
        choices = getattr(chunk, "choices", None)
        if choices:
            delta = choices[0].delta
            content = getattr(delta, "content", None) if delta else None
            if content:
                yield content

    if usage is not None:
        prompt_tok = getattr(usage, "prompt_tokens", 0) or 0
        out_tok = getattr(usage, "completion_tokens", 0) or 0
        details = getattr(usage, "prompt_tokens_details", None)
        cr_tok = (getattr(details, "cached_tokens", 0) or 0) if details else 0
        in_tok = max(prompt_tok - cr_tok, 0)
        cost = calc_cost_usd(model, in_tok, out_tok, cr_tok, 0)
        try:
            db.log_llm_call(
                paper_id=paper_id,
                stage=stage,
                model=model,
                input_tokens=in_tok,
                output_tokens=out_tok,
                cache_read_tokens=cr_tok,
                cache_write_tokens=0,
                cost_usd=cost,
            )
        except Exception:
            pass
