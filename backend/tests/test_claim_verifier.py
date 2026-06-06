"""Tests for Smart Citation claim–evidence verification."""
from __future__ import annotations

from app import claim_verifier, llm


def test_empty_abstract_returns_unknown_without_llm(monkeypatch):
    called = False

    def spy(**_kwargs):
        nonlocal called
        called = True
        return {}

    monkeypatch.setattr(llm, "call_with_tool", spy)
    out = claim_verifier.verify("某主張", "Title", "", "d", "zh-Hant")
    assert out["verdict"] == "unknown"
    assert called is False


def test_empty_claim_returns_unknown_without_llm(monkeypatch):
    monkeypatch.setattr(llm, "call_with_tool", lambda **_k: {})
    assert claim_verifier.verify("   ", "T", "some abstract", "d", "en")["verdict"] == "unknown"


def test_verify_passes_through_llm_verdict(monkeypatch):
    def fake(**kwargs):
        assert kwargs["stage"] == "claim_verify"
        assert "Claim:" in kwargs["user_content"] and "abstract" in kwargs["user_content"].lower()
        return {"verdict": "supports", "evidence": "We show X improves Y.",
                "reason": "摘要直接證實該主張。", "confidence": 0.9}

    monkeypatch.setattr(llm, "call_with_tool", fake)
    out = claim_verifier.verify("X improves Y", "A paper", "We show X improves Y.", "d", "zh-Hant")
    assert out["verdict"] == "supports"
    assert out["evidence"] == "We show X improves Y."


def test_rate_limit_blocks_after_ceiling(monkeypatch):
    monkeypatch.setattr(claim_verifier, "_rate_buckets", {})
    monkeypatch.setattr(claim_verifier, "RATE_LIMIT_PER_MIN", 1)
    assert claim_verifier.check_rate_limit("d")[0] is True
    allowed, wait = claim_verifier.check_rate_limit("d")
    assert allowed is False and wait >= 1
