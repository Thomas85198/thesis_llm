"""Claude API wrapper with prompt caching, structured tool-use output."""
from __future__ import annotations

import json
import os
from typing import Any

from anthropic import Anthropic

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
) -> dict[str, Any]:
    """Call Claude with a single forced tool — returns the tool input dict.

    System prompt is cached so repeated calls across sections or rules hit cache.
    User content is the per-call payload.
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

    for block in response.content:
        if block.type == "tool_use" and block.name == tool_name:
            return block.input  # type: ignore[return-value]

    raise RuntimeError(
        f"Claude did not return tool_use for {tool_name}. "
        f"Got: {json.dumps([b.model_dump() for b in response.content])[:500]}"
    )
