"""Tests for full-text sentence-level citation grounding."""

from __future__ import annotations

from app import db, grounding, llm, openalex


def test_split_sentences_filters_short():
    text = (
        "短。\nThis is a sufficiently long first sentence about attention. "
        "這是第二句夠長的中文句子，用於測試切句與長度過濾功能是否正確。"
    )
    out = grounding._split_sentences(text)
    assert all(len(s) >= grounding.MIN_SENT_CHARS for s in out)
    assert len(out) == 2  # the tiny "短。" is filtered out


def test_ground_uses_fulltext_and_ranks(monkeypatch):
    # Pretend nothing cached → build from "full text".
    store = {}
    monkeypatch.setattr(db, "get_paper_chunks", lambda oid: store.get(oid, []))

    def upsert(oid, source, chunks):
        store[oid] = [
            {"idx": i, "text": t, "embedding": e, "source": source}
            for i, t, e in chunks
        ]

    monkeypatch.setattr(db, "upsert_paper_chunks", upsert)
    monkeypatch.setattr(
        grounding,
        "_fetch_fulltext",
        lambda url: (
            "Self-attention models long-range dependencies effectively here. "
            "The weather in Paris is mild during spring season."
        ),
    )
    # oa_url is now re-derived server-side (SSRF fix) — the client-supplied URL
    # is ignored, so the OpenAlex lookup must be stubbed.
    monkeypatch.setattr(
        openalex,
        "get_works_by_ids",
        lambda ids: {"W1": {"oa_url": "http://x/p.pdf", "abstract": ""}},
    )
    # claim vec [1,0]; first sentence aligned, second orthogonal.
    embeds = {"build": [[1.0, 0.0], [0.0, 1.0]], "claim": [[1.0, 0.0]]}
    calls = {"n": 0}

    def fake_embed(texts):
        calls["n"] += 1
        return embeds["claim"] if len(texts) == 1 else embeds["build"]

    monkeypatch.setattr(llm, "embed", fake_embed)

    out = grounding.ground("W1", "http://x/p.pdf", "self-attention long-range", "d")
    assert out["source"] == "fulltext"
    assert out["supporting"][0]["sentence"].startswith("Self-attention")
    # second call (claim) reuses cached chunks → no re-embed of the body
    out2 = grounding.ground("W1", "http://x/p.pdf", "self-attention long-range", "d")
    assert out2["supporting"][0]["sentence"].startswith("Self-attention")


def test_ground_falls_back_to_abstract(monkeypatch):
    store = {}
    monkeypatch.setattr(db, "get_paper_chunks", lambda oid: store.get(oid, []))
    monkeypatch.setattr(
        db,
        "upsert_paper_chunks",
        lambda oid, source, chunks: store.__setitem__(
            oid,
            [
                {"idx": i, "text": t, "embedding": e, "source": source}
                for i, t, e in chunks
            ],
        ),
    )
    monkeypatch.setattr(grounding, "_fetch_fulltext", lambda url: "")  # no full text
    monkeypatch.setattr(
        openalex,
        "get_works_by_ids",
        lambda ids: {
            "W1": {
                "abstract": "We propose a model for long-range dependencies in sequences."
            }
        },
    )
    monkeypatch.setattr(llm, "embed", lambda texts: [[1.0]] * len(texts))
    out = grounding.ground("W1", "", "claim", "d")
    assert out["source"] == "abstract"
    assert len(out["supporting"]) >= 1


def test_ground_empty_claim_returns_none(monkeypatch):
    monkeypatch.setattr(
        llm,
        "embed",
        lambda texts: (_ for _ in ()).throw(AssertionError("should not embed")),
    )
    assert grounding.ground("W1", "u", "  ", "d") == {
        "source": "none",
        "supporting": [],
    }


def test_rate_limit(monkeypatch):
    monkeypatch.setattr(grounding, "_rate_buckets", {})
    monkeypatch.setattr(grounding, "RATE_LIMIT_PER_MIN", 1)
    assert grounding.check_rate_limit("d")[0] is True
    assert grounding.check_rate_limit("d")[0] is False
