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
    # OpenAlex's own oa_url is a flaky scraped mirror; a stable arXiv copy lives
    # in `locations`. We must ignore the former and surface the latter.
    "open_access": {"is_oa": True, "oa_url": "https://scraped-mirror.example/dl/9"},
    "locations": [
        {"is_oa": True, "source": None,
         "pdf_url": "https://scraped-mirror.example/dl/9"},  # untrusted → skipped
        {"is_oa": True, "source": {"display_name": "arXiv"},
         "landing_page_url": "https://arxiv.org/abs/1706.03762",
         "pdf_url": "https://arxiv.org/pdf/1706.03762"},
    ],
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
    # trusted arXiv landing, NOT the scraped mirror OpenAlex offered as oa_url
    assert out["oa_url"] == "https://arxiv.org/abs/1706.03762"
    assert out["url"] == "https://arxiv.org/abs/1706.03762"
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


# ---------- fulltext_url / source_url ----------

def test_fulltext_url_skips_untrusted_mirror_for_trusted_arxiv():
    work = {
        "open_access": {"oa_url": "https://scraped-mirror.example/x"},
        "locations": [
            {"is_oa": True, "source": None,
             "pdf_url": "https://scraped-mirror.example/x"},
            {"is_oa": True, "source": {"display_name": "arXiv"},
             "landing_page_url": "https://arxiv.org/abs/1706.03762"},
        ],
    }
    assert openalex.fulltext_url(work) == "https://arxiv.org/abs/1706.03762"


def test_fulltext_url_prefers_landing_over_pdf():
    work = {
        "locations": [
            {"is_oa": True, "source": {"display_name": "arXiv"},
             "landing_page_url": "https://arxiv.org/abs/1", "pdf_url": "https://arxiv.org/pdf/1"},
        ],
    }
    assert openalex.fulltext_url(work) == "https://arxiv.org/abs/1"


def test_fulltext_url_empty_when_no_trusted_oa():
    # Only an untrusted mirror is OA → no full-text link (better than a dead one).
    work = {"locations": [{"is_oa": True, "pdf_url": "https://random.example/p.pdf"}]}
    assert openalex.fulltext_url(work) == ""
    # Non-OA trusted-looking host is also ignored (we require is_oa).
    work2 = {"locations": [{"is_oa": False, "landing_page_url": "https://arxiv.org/abs/2"}]}
    assert openalex.fulltext_url(work2) == ""


def test_fulltext_url_ignores_doi_org_landing():
    work = {"locations": [{"is_oa": True, "landing_page_url": "https://doi.org/10.1/x"}]}
    assert openalex.fulltext_url(work) == ""


def test_source_url_falls_back_doi_then_landing_then_record():
    base_loc = {"landing_page_url": "https://pub/land"}
    # trusted full text wins
    work = {"doi": "https://doi.org/10.1/x", "primary_location": base_loc,
            "locations": [{"is_oa": True, "source": {"display_name": "arXiv"},
                           "landing_page_url": "https://arxiv.org/abs/9"}]}
    assert openalex.source_url(work) == "https://arxiv.org/abs/9"
    # no trusted full text → DOI
    work = {"doi": "https://doi.org/10.1/x", "primary_location": base_loc}
    assert openalex.source_url(work) == "https://doi.org/10.1/x"
    # no DOI → primary landing page
    work = {"primary_location": base_loc}
    assert openalex.source_url(work) == "https://pub/land"
    # nothing but the record id
    assert openalex.source_url({"id": "https://openalex.org/W9"}) == "https://openalex.org/W9"


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


# ---------- get_works_by_ids (refresh) ----------

def test_get_works_by_ids_keys_by_openalex_id(fake_httpx):
    out = openalex.get_works_by_ids(["W123", "W999"])
    assert set(out) == {"W123"}  # only the work OpenAlex returned
    assert out["W123"]["oa_url"] == "https://arxiv.org/abs/1706.03762"
    # ids forwarded as an OR filter
    assert fake_httpx.captured["params"]["filter"] == "openalex_id:W123|W999"


def test_get_works_by_ids_drops_malformed_ids(fake_httpx):
    # A malformed id would 400 the whole batch on OpenAlex; we filter it out so
    # only the well-formed ones are queried.
    openalex.get_works_by_ids(["W123", "not-an-id", "", "https://openalex.org/W5"])
    assert fake_httpx.captured["params"]["filter"] == "openalex_id:W123"


def test_get_works_by_ids_empty_skips_call(fake_httpx):
    assert openalex.get_works_by_ids(["  ", "garbage"]) == {}
    assert fake_httpx.captured == {}


# ---------- rerank_by_claim (semantic re-ranking) ----------

def test_rerank_orders_by_claim_similarity(monkeypatch):
    cands = [
        {"openalex_id": "A", "abstract": "about soil bacteria"},
        {"openalex_id": "B", "abstract": "self-attention long-range dependencies"},
    ]
    # embed returns [claim, abstractA, abstractB]: claim=[1,0]; A orthogonal,
    # B aligned → B ranks first.
    monkeypatch.setattr(
        citation.llm, "embed", lambda texts: [[1.0, 0.0], [0.0, 1.0], [0.96, 0.28]]
    )
    out = citation.rerank_by_claim("self attention", cands)
    assert [c["openalex_id"] for c in out] == ["B", "A"]  # B (similar) first


def test_rerank_graceful_on_embed_failure(monkeypatch):
    cands = [{"openalex_id": "A", "abstract": "x"}, {"openalex_id": "B", "abstract": "y"}]
    def boom(_texts):
        raise RuntimeError("no quota")
    monkeypatch.setattr(citation.llm, "embed", boom)
    out = citation.rerank_by_claim("c", cands)
    assert [c["openalex_id"] for c in out] == ["A", "B"]  # unchanged order


def test_rerank_keeps_abstract_less_at_end(monkeypatch):
    cands = [{"openalex_id": "A", "abstract": ""}, {"openalex_id": "B", "abstract": "y"},
             {"openalex_id": "C", "abstract": "z"}]
    monkeypatch.setattr(citation.llm, "embed", lambda texts: [[1.0], [0.5], [1.0]])
    out = citation.rerank_by_claim("c", cands)
    assert out[-1]["openalex_id"] == "A"  # the abstract-less one sinks to the end


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
