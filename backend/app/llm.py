"""Claude API wrapper with prompt caching, structured tool-use output, cost logging."""
from __future__ import annotations

import json
import os
from typing import Any

from anthropic import Anthropic

from . import db

_client: Anthropic | None = None


def client() -> Anthropic:
    global _client
    if _client is None:
        _client = Anthropic()
    return _client


def model_heavy() -> str:
    return os.getenv("ANTHROPIC_MODEL_HEAVY", "claude-opus-4-7")


def model_light() -> str:
    return os.getenv("ANTHROPIC_MODEL_LIGHT", "claude-sonnet-4-6")


# Anthropic list pricing (USD per 1M tokens). Approximate; updated 2026-Q1.
# Each entry: (input, output, cache_read, cache_write).
PRICING: dict[str, tuple[float, float, float, float]] = {
    "claude-opus-4-7":              (15.00, 75.00, 1.50, 18.75),
    "claude-opus-4-7[1m]":          (15.00, 75.00, 1.50, 18.75),
    "claude-sonnet-4-6":            ( 3.00, 15.00, 0.30,  3.75),
    "claude-haiku-4-5-20251001":    ( 1.00,  5.00, 0.10,  1.25),
}


def _price(model: str) -> tuple[float, float, float, float]:
    base = model.split("[", 1)[0]
    return PRICING.get(base) or PRICING.get(model) or (0.0, 0.0, 0.0, 0.0)


def calc_cost_usd(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> float:
    in_p, out_p, cr_p, cw_p = _price(model)
    return (
        input_tokens * in_p
        + output_tokens * out_p
        + cache_read_tokens * cr_p
        + cache_write_tokens * cw_p
    ) / 1_000_000


def call_with_tool(
    *,
    model: str,
    system: str,
    user_content: str,
    tool_name: str,
    tool_description: str,
    tool_input_schema: dict[str, Any],
    cache_system: bool = True,
    max_tokens: int = 8192,
    paper_id: str | None = None,
    stage: str = "unspecified",
) -> dict[str, Any]:
    """Call Claude with a single forced tool — returns the tool input dict.

    System prompt is cached. Token usage is logged to SQLite via db.log_llm_call
    so /api/cost endpoints can summarize per-paper / per-stage spending.
    """
    system_blocks: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": system,
            **({"cache_control": {"type": "ephemeral"}} if cache_system else {}),
        }
    ]

    response = client().messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system_blocks,
        tools=[
            {
                "name": tool_name,
                "description": tool_description,
                "input_schema": tool_input_schema,
            }
        ],
        tool_choice={"type": "tool", "name": tool_name},
        messages=[{"role": "user", "content": user_content}],
    )

    # Anthropic returns cache stats only if caching is in play.
    usage = response.usage
    in_tok = getattr(usage, "input_tokens", 0) or 0
    out_tok = getattr(usage, "output_tokens", 0) or 0
    cr_tok = getattr(usage, "cache_read_input_tokens", 0) or 0
    cw_tok = getattr(usage, "cache_creation_input_tokens", 0) or 0
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

    for block in response.content:
        if block.type == "tool_use" and block.name == tool_name:
            return block.input  # type: ignore[return-value]

    raise RuntimeError(
        f"Claude did not return tool_use for {tool_name}. "
        f"Got: {json.dumps([b.model_dump() for b in response.content])[:500]}"
    )
