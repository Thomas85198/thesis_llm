"""Roundtrip tests for db.py papers / results / content-hash cache.

This is the upload dedup path (docs/TODO.md E5: previously zero coverage):
re-uploading an identical file must return the prior paper_id WITHOUT
recomputing — but only once a finished result exists.
Storage is isolated per-test by the global conftest fixture.
"""

from __future__ import annotations

from app import db

HASH = "a" * 64


def _paper(paper_id="paper:t1", content_hash=HASH, title="測試論文"):
    db.upsert_paper(
        paper_id=paper_id,
        title=title,
        filename="t.pdf",
        content_hash=content_hash,
        pdf_path=f"{paper_id.replace(':', '_')}.pdf",
    )


def test_paper_roundtrip():
    _paper()

    got = db.get_paper("paper:t1")

    assert got is not None
    assert got["title"] == "測試論文"
    assert got["content_hash"] == HASH
    assert got["created_at"]  # stamped


def test_upsert_same_paper_id_updates_in_place():
    _paper(title="舊標題")
    _paper(title="新標題")

    got = db.get_paper("paper:t1")

    assert got["title"] == "新標題"
    assert len(db.list_papers()) == 1


def test_get_paper_missing_returns_none():
    assert db.get_paper("paper:nope") is None


def test_cache_ignores_paper_without_finished_result():
    """In-flight uploads (paper row, no result yet) must NOT count as cache
    hits — otherwise a crash mid-analysis would poison dedup forever."""
    _paper()

    assert db.get_paper_by_hash(HASH) is None


def test_cache_hits_once_result_is_persisted():
    _paper()
    db.upsert_result("paper:t1", {"defects": []})

    hit = db.get_paper_by_hash(HASH)

    assert hit is not None
    assert hit["paper_id"] == "paper:t1"


def test_cache_prefers_most_recently_finished_duplicate():
    _paper(paper_id="paper:old")
    db.upsert_result("paper:old", {"defects": []})
    _paper(paper_id="paper:new")
    db.upsert_result("paper:new", {"defects": []})

    # finished_at has second precision at worst; force distinct ordering.
    with db.connect() as c:
        c.execute(
            "UPDATE results SET finished_at='2999-01-01T00:00:00+00:00' "
            "WHERE paper_id='paper:new'"
        )

    assert db.get_paper_by_hash(HASH)["paper_id"] == "paper:new"


def test_result_roundtrip_preserves_unicode_payload():
    _paper()
    result = {
        "defects": [{"rule_id": "REL-01", "description": {"zh-Hant": "缺陷～"}}],
        "note": "中文內容 with mixed English",
    }

    db.upsert_result("paper:t1", result)

    assert db.get_result("paper:t1") == result


def test_upsert_result_replaces_previous():
    _paper()
    db.upsert_result("paper:t1", {"defects": [], "v": 1})
    db.upsert_result("paper:t1", {"defects": [], "v": 2})

    assert db.get_result("paper:t1")["v"] == 2


def test_get_result_missing_returns_none():
    assert db.get_result("paper:nope") is None


def test_delete_paper_removes_result_and_cache_entry():
    _paper()
    db.upsert_result("paper:t1", {"defects": []})

    db.delete_paper("paper:t1")

    assert db.get_paper("paper:t1") is None
    assert db.get_result("paper:t1") is None
    assert db.get_paper_by_hash(HASH) is None


def test_list_papers_reports_has_result_flag():
    _paper(paper_id="paper:done")
    db.upsert_result("paper:done", {"defects": []})
    _paper(paper_id="paper:pending", content_hash="b" * 64)

    by_id = {p["paper_id"]: p for p in db.list_papers()}

    assert by_id["paper:done"]["has_result"]
    assert not by_id["paper:pending"]["has_result"]


def test_upsert_result_denormalizes_counts():
    """list_papers reads defect/EDU counts from denormalized columns — the
    whole point is skipping the multi-MB json.loads per paper (E4 N+1)."""
    _paper()
    db.upsert_result(
        "paper:t1",
        {
            "defects": [{"rule_id": "REL-01"}, {"rule_id": "REL-02"}],
            "graph": {"edus": [{"id": "e1"}, {"id": "e2"}, {"id": "e3"}]},
        },
    )

    row = {p["paper_id"]: p for p in db.list_papers()}["paper:t1"]

    assert row["defect_count"] == 2
    assert row["edu_count"] == 3


def test_upsert_result_counts_follow_replacement():
    _paper()
    db.upsert_result("paper:t1", {"defects": [{}], "graph": {"edus": [{}]}})
    db.upsert_result("paper:t1", {"defects": [], "graph": {"edus": [{}, {}]}})

    row = {p["paper_id"]: p for p in db.list_papers()}["paper:t1"]

    assert row["defect_count"] == 0
    assert row["edu_count"] == 2


def test_migration_backfills_counts_for_existing_rows(tmp_path):
    """A pre-2026-07 DB (no count columns) must get columns + backfill."""
    import json
    import sqlite3

    conn = sqlite3.connect(tmp_path / "old.db")
    conn.execute(
        "CREATE TABLE papers (paper_id TEXT PRIMARY KEY, title TEXT, "
        "filename TEXT, content_hash TEXT, pdf_path TEXT, created_at TEXT NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE results (paper_id TEXT PRIMARY KEY, "
        "result_json TEXT NOT NULL, finished_at TEXT NOT NULL)"
    )
    result = {"defects": [{}], "graph": {"edus": [{}, {}]}}
    conn.execute(
        "INSERT INTO results VALUES ('paper:old', ?, 'x')", (json.dumps(result),)
    )
    conn.execute("INSERT INTO results VALUES ('paper:bad', 'not json', 'x')")

    db._migrate(conn)

    rows = dict(conn.execute("SELECT paper_id, defect_count FROM results").fetchall())
    assert rows["paper:old"] == 1
    assert rows["paper:bad"] is None  # unreadable JSON left NULL, not crashed
    assert (
        conn.execute(
            "SELECT edu_count FROM results WHERE paper_id='paper:old'"
        ).fetchone()[0]
        == 2
    )
    conn.close()
