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
import time
from typing import Any

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

# Transient errors worth retrying with exponential backoff.
# 5xx = OpenAI-side issue; 429 = rate limit; connection/timeout = network blip.
RETRYABLE_ERRORS = (
    InternalServerError,   # 5xx
    APIConnectionError,    # network
    APITimeoutError,       # timeout
    RateLimitError,        # 429
)
MAX_RETRIES = 4  # total attempts = MAX_RETRIES + 1


def client() -> OpenAI:
    global _client
    if _client is None:
        # OPENAI_BASE_URL supports Azure / lab self-hosted proxies / vLLM endpoints.
        # max_retries is the SDK's own retry knob; we add our own outer retry too
        # because we want stage-aware logging and custom backoff.
        kwargs: dict[str, Any] = {"max_retries": 2}
        base = os.getenv("OPENAI_BASE_URL")
        if base:
            kwargs["base_url"] = base
        _client = OpenAI(**kwargs)
    return _client


def model_heavy() -> str:
    return os.getenv("OPENAI_MODEL_HEAVY", "gpt-4.1")


def model_light() -> str:
    return os.getenv("OPENAI_MODEL_LIGHT", "gpt-4.1-mini")


def model_cross_section() -> str:
    # Cross-section pass needs long context; default to gpt-4.1 (1M).
    return os.getenv("OPENAI_MODEL_CROSS_SECTION", "gpt-4.1")


# OpenAI list pricing (USD per 1M tokens). Approximate; updated 2026-Q1.
# Each entry: (input, output, cached_input). OpenAI charges no cache-write fee.
PRICING: dict[str, tuple[float, float, float]] = {
    "gpt-4.1":          (2.00,  8.00, 0.50),
    "gpt-4.1-mini":     (0.40,  1.60, 0.10),
    "gpt-4.1-nano":     (0.10,  0.40, 0.025),
    "gpt-4o":           (2.50, 10.00, 1.25),
    "gpt-4o-mini":      (0.15,  0.60, 0.075),
    "o1":               (15.00, 60.00, 7.50),
    "o3-mini":          (1.10,  4.40, 0.55),
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
        input_tokens * in_p
        + output_tokens * out_p
        + cache_read_tokens * cr_p
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
    max_tokens: int = 8192,
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
                max_completion_tokens=max_tokens,
                messages=messages,
                tools=tools,
                tool_choice={"type": "function", "function": {"name": tool_name}},
            )
            break  # success
        except RETRYABLE_ERRORS as exc:
            last_exc = exc
            if attempt == MAX_RETRIES:
                print(
                    f"[llm] {type(exc).__name__} on stage={stage} model={model} "
                    f"after {MAX_RETRIES + 1} attempts — giving up: {exc!r}"
                )
                raise
            backoff = (1.5 * (2 ** attempt)) + random.uniform(0, 0.5)
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
