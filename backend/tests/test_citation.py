"""Unit tests for Smart Citation (OpenAlex client + recommend rate limit).

No real network — httpx.Client is monkeypatched with a fake. Covers the two
tricky bits: abstract inverted-index restoration and candidate normalization
(including missing fields), plus the per-doc rate-limit backstop.
"""
from __future__ import annotations

import httpx
import pytest

from app import citation, openalex


# ---------- restore_abstract ----------

def test_restore_abstract_reorders_by_position():
    inverted = {"Hello": [0], "world": [1], "again": [2, 4], "and": [3]}
    assert openalex.restore_abstract(inverted) == "Hello world again and again"


@pytest.mark.parametrize("empty", [None, {}])
def test_restore_abstract_empty(empty):
    assert openalex.restore_abstract(empty) == ""


# ---------- normalize ----------

FULL_WORK = {
    "id": "https://openalex.org/W123",
    "title": "Attention Is All You Need",
    "publication_year": 2017,
    "doi": "https://doi.org/10.5555/xyz",
    "authorships": [
        {"author": {"display_name": "Ashish Vaswani"}},
        {"author": {"display_name": "Noam Shazeer"}},
    ],
    "primary_location": {
        "source": {"display_name": "NeurIPS"},
        "landing_page_url": "https://nips.cc/paper/123",
    },
    "open_access": {"is_oa": True, "oa_url": "https://oa.example/123.pdf"},
    "cited_by_count": 54321,
    "type": "article",
    "abstract_inverted_index": {"The": [0], "model": [1]},
    "relevance_score": 12.3,
}


def test_normalize_full_work():
    out = openalex.normalize(FULL_WORK)
    assert out["openalex_id"] == "W123"
    assert out["title"] == "Attention Is All You Need"
    assert out["authors"] == ["Ashish Vaswani", "Noam Shazeer"]
    assert out["year"] == 2017
    assert out["venue"] == "NeurIPS"
    assert out["doi"] == "https://doi.org/10.5555/xyz"
    assert out["oa_url"] == "https://oa.example/123.pdf"  # OA full text, separate field
    assert out["url"] == "https://oa.example/123.pdf"  # OA full text preferred
    assert out["cited_by_count"] == 54321
    assert out["type"] == "article"
    assert out["abstract"] == "The model"
    assert out["relevance_score"] == 12.3


def test_normalize_tolerates_missing_fields():
    out = openalex.normalize({})  # a work with nothing
    assert out["openalex_id"] == ""
    assert out["title"] == "(untitled)"
    assert out["authors"] == []
    assert out["year"] is None
    assert out["venue"] == ""
    assert out["doi"] == ""
    assert out["oa_url"] == ""
    assert out["url"] == ""
    assert out["cited_by_count"] == 0
    assert out["type"] == ""
    assert out["abstract"] == ""


def test_normalize_falls_back_to_display_name():
    out = openalex.normalize({"display_name": "Fallback Title"})
    assert out["title"] == "Fallback Title"


# ---------- best_url fallback chain ----------

def test_best_url_prefers_oa_then_doi_then_landing_then_record():
    work = {
        "id": "https://openalex.org/W9",
        "doi": "https://doi.org/10.1/x",
        "open_access": {"oa_url": "https://oa/full.pdf"},
    }
    loc = {"landing_page_url": "https://pub/land"}
    assert openalex.best_url(work, loc) == "https://oa/full.pdf"
    work.pop("open_access")
    assert openalex.best_url(work, loc) == "https://doi.org/10.1/x"
    work.pop("doi")
    assert openalex.best_url(work, loc) == "https://pub/land"
    assert openalex.best_url({"id": "https://openalex.org/W9"}, {}) == "https://openalex.org/W9"


# ---------- search_works (httpx mocked) ----------

class _FakeResp:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        pass

    def json(self):
        return self._data


class _FakeClient:
    """Stand-in for httpx.Client; records the GET params for assertions."""

    captured: dict = {}
    payload: dict = {"results": []}

    def __init__(self, *a, **k):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get(self, url, params=None):
        _FakeClient.captured = {"url": url, "params": params}
        return _FakeResp(_FakeClient.payload)


@pytest.fixture
def fake_httpx(monkeypatch):
    _FakeClient.captured = {}
    _FakeClient.payload = {"results": [FULL_WORK]}
    monkeypatch.setattr(openalex.httpx, "Client", _FakeClient)
    return _FakeClient


def test_search_works_normalizes_results(fake_httpx):
    out = openalex.search_works("transformer attention")
    assert len(out) == 1
    assert out[0]["openalex_id"] == "W123"
    # query forwarded as the `search` param, capped per-page sane
    assert fake_httpx.captured["params"]["search"] == "transformer attention"


def test_search_works_empty_query_skips_call(fake_httpx):
    assert openalex.search_works("   ") == []
    assert fake_httpx.captured == {}  # never hit the network


# ---------- to_search_query (CJK → English via LLM) ----------

def test_to_search_query_english_passthrough():
    # No CJK → returned verbatim, no LLM call.
    assert citation.to_search_query("transformer attention") == "transformer attention"


def test_to_search_query_chinese_uses_llm(monkeypatch):
    monkeypatch.setattr(
        citation.llm, "call_with_tool", lambda **k: {"query": "self attention long range"}
    )
    assert citation.to_search_query("自注意力機制") == "self attention long range"


def test_to_search_query_chinese_llm_failure_falls_back(monkeypatch):
    def boom(**k):
        raise RuntimeError("insufficient_quota")

    monkeypatch.setattr(citation.llm, "call_with_tool", boom)
    # No quota → degrade to the raw claim instead of blocking the search.
    assert citation.to_search_query("自注意力機制") == "自注意力機制"


# ---------- recommend (error wrapping) ----------

def test_recommend_wraps_httpx_error(monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("no route to host")

    monkeypatch.setattr(openalex, "search_works", boom)
    with pytest.raises(citation.CitationSearchError):
        citation.recommend("anything")


# ---------- rate limit ----------

def test_rate_limit_allows_then_blocks(monkeypatch):
    monkeypatch.setattr(citation, "_rate_buckets", {})
    doc = "doc:rl"
    for _ in range(citation.RATE_LIMIT_PER_MIN):
        allowed, _ = citation.check_rate_limit(doc)
        assert allowed
    allowed, wait = citation.check_rate_limit(doc)
    assert not allowed
    assert wait >= 1


def test_rate_limit_is_per_document(monkeypatch):
    monkeypatch.setattr(citation, "_rate_buckets", {})
    for _ in range(citation.RATE_LIMIT_PER_MIN):
        citation.check_rate_limit("doc:a")
    # a different doc has its own fresh bucket
    allowed, _ = citation.check_rate_limit("doc:b")
    assert allowed
