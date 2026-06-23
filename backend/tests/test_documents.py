"""Unit tests for editor-mode document persistence (db.py documents/versions).

No network, no Neo4j — pure SQLite against a throwaway temp DB. Each test gets a
fresh DB by repointing db.DB_PATH and clearing the init flag, so these never
touch the real data.db.
"""

from __future__ import annotations

import importlib

import pytest

from app import db


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    """Point db at an empty temp file and force re-init for this test."""
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(db, "_initialized", False)
    yield db
    importlib.reload(db)  # restore module-level DB_PATH for any later import


DOC = {
    "type": "doc",
    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hello"}]}],
}


def test_create_and_get_roundtrip(fresh_db):
    created = db.create_document("doc:aaa", "我的論文", DOC, "zh-Hant")
    assert created["doc_id"] == "doc:aaa"
    assert created["content_json"] == DOC  # returned as dict, not JSON string

    got = db.get_document("doc:aaa")
    assert got is not None
    assert got["title"] == "我的論文"
    assert got["locale"] == "zh-Hant"
    assert got["content_json"] == DOC  # parsed back into a dict


def test_get_missing_returns_none(fresh_db):
    assert db.get_document("doc:nope") is None


def test_list_excludes_content_blob(fresh_db):
    db.create_document("doc:a", "A", DOC, "en")
    db.create_document("doc:b", "B", DOC, "zh-Hant")
    rows = db.list_documents()
    assert {r["doc_id"] for r in rows} == {"doc:a", "doc:b"}
    assert "content_json" not in rows[0]  # list view is lightweight


def test_update_content_only_keeps_title(fresh_db):
    db.create_document("doc:a", "原標題", DOC, "zh-Hant")
    new_doc = {"type": "doc", "content": [{"type": "paragraph"}]}
    assert db.update_document("doc:a", content_json=new_doc) is True
    got = db.get_document("doc:a")
    assert got["title"] == "原標題"  # untouched by a content-only autosave
    assert got["content_json"] == new_doc


def test_update_title_only_keeps_content(fresh_db):
    db.create_document("doc:a", "原標題", DOC, "zh-Hant")
    assert db.update_document("doc:a", title="新標題") is True
    got = db.get_document("doc:a")
    assert got["title"] == "新標題"
    assert got["content_json"] == DOC  # untouched by a title-only rename


def test_update_missing_returns_false(fresh_db):
    assert db.update_document("doc:ghost", title="x") is False


def test_delete_cascades_versions(fresh_db):
    db.create_document("doc:a", "A", DOC, "en")
    db.snapshot_document("doc:a", DOC, label="manual")
    db.delete_document("doc:a")
    assert db.get_document("doc:a") is None
    assert db.list_document_versions("doc:a") == []  # cascade wiped snapshots


def test_snapshot_and_fetch_version(fresh_db):
    db.create_document("doc:a", "A", DOC, "en")
    vid = db.snapshot_document("doc:a", DOC, label="初稿")
    versions = db.list_document_versions("doc:a")
    assert len(versions) == 1
    assert versions[0]["label"] == "初稿"
    fetched = db.get_document_version("doc:a", vid)
    assert fetched["content_json"] == DOC


def test_autosave_versions_are_pruned(fresh_db):
    db.create_document("doc:a", "A", DOC, "en")
    # Write more autosave snapshots than the cap; oldest should be pruned.
    for i in range(db.MAX_AUTOSAVE_VERSIONS + 5):
        db.snapshot_document("doc:a", {"type": "doc", "n": i}, label="autosave")
    autosaves = [
        v for v in db.list_document_versions("doc:a") if v["label"] == "autosave"
    ]
    assert len(autosaves) == db.MAX_AUTOSAVE_VERSIONS


def test_labelled_versions_never_pruned(fresh_db):
    db.create_document("doc:a", "A", DOC, "en")
    db.snapshot_document("doc:a", DOC, label="重要版")
    for i in range(db.MAX_AUTOSAVE_VERSIONS + 5):
        db.snapshot_document("doc:a", {"type": "doc", "n": i}, label="autosave")
    labels = [v["label"] for v in db.list_document_versions("doc:a")]
    assert "重要版" in labels  # manual version survives the autosave prune


def test_oversized_content_rejected(fresh_db, monkeypatch):
    db.create_document("doc:a", "A", DOC, "en")
    monkeypatch.setattr(db, "MAX_DOC_BYTES", 50)  # tiny cap for the test
    big = {"type": "doc", "text": "x" * 200}
    with pytest.raises(ValueError):
        db.update_document("doc:a", content_json=big)
    with pytest.raises(ValueError):
        db.snapshot_document("doc:a", big, label="autosave")


def test_optimistic_concurrency_db(fresh_db):
    db.create_document("doc:a", "A", DOC, "en")
    stale = db.get_document("doc:a")["updated_at"]
    # Matching token succeeds.
    assert (
        db.update_document("doc:a", content_json=DOC, expected_updated_at=stale) is True
    )
    fresh = db.get_document("doc:a")["updated_at"]
    # The now-stale token is rejected (no clobber).
    assert (
        db.update_document("doc:a", content_json=DOC, expected_updated_at=stale)
        is False
    )
    # The fresh token works again.
    assert (
        db.update_document("doc:a", content_json=DOC, expected_updated_at=fresh) is True
    )
