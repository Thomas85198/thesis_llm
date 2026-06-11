"""Tests for the upload audit trail + admin API + email no-op.

Pure SQLite against a throwaway temp DB (same pattern as test_documents.py).
No network, no Neo4j, no real SMTP.
"""
from __future__ import annotations

import importlib

import pytest

from app import db, notify


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(db, "_initialized", False)
    yield db
    importlib.reload(db)


# ---------- db.upload_events helpers ----------

def test_log_start_then_done(fresh_db):
    db.log_upload_start(
        job_id="job:1", paper_id="paper:1", filename="a.pdf",
        file_size=123, content_hash="h1", pdf_path="paper_1.pdf",
    )
    rows = db.list_upload_events()
    assert len(rows) == 1
    assert rows[0]["status"] == "pending"
    assert rows[0]["filename"] == "a.pdf"
    assert rows[0]["finished_at"] is None

    db.mark_upload_done("job:1")
    rows = db.list_upload_events()
    assert rows[0]["status"] == "done"
    assert rows[0]["finished_at"] is not None


def test_log_start_then_failed(fresh_db):
    db.log_upload_start(
        job_id="job:2", paper_id="paper:2", filename="bad.pdf",
        file_size=9, content_hash="h2", pdf_path="paper_2.pdf",
    )
    db.mark_upload_failed("job:2", "RuntimeError", "checking", "boom")
    ev = db.list_upload_events(status="error")[0]
    assert ev["status"] == "error"
    assert ev["error_type"] == "RuntimeError"
    assert ev["error_stage"] == "checking"
    assert ev["error_message"] == "boom"
    # pdf_path survives so the admin page can still offer the file for download.
    assert ev["pdf_path"] == "paper_2.pdf"


def test_cached_status_marks_finished_immediately(fresh_db):
    db.log_upload_start(
        job_id="job:3", paper_id="paper:1", filename="a.pdf",
        file_size=123, content_hash="h1", pdf_path="paper_1.pdf",
        status="cached",
    )
    ev = db.list_upload_events()[0]
    assert ev["status"] == "cached"
    assert ev["finished_at"] is not None


def test_list_filter_and_limit(fresh_db):
    for i in range(5):
        db.log_upload_start(
            job_id=f"job:{i}", paper_id=None, filename=f"f{i}.pdf",
            file_size=i, content_hash=None, pdf_path=None,
        )
    db.mark_upload_failed("job:2", "ValueError", "extracting", "x")
    assert len(db.list_upload_events(limit=3)) == 3
    assert len(db.list_upload_events(status="error")) == 1
    assert len(db.list_upload_events(status="pending")) == 4


def test_get_upload_event_by_id(fresh_db):
    db.log_upload_start(
        job_id="job:9", paper_id="paper:9", filename="z.pdf",
        file_size=1, content_hash="h", pdf_path="paper_9.pdf",
    )
    eid = db.list_upload_events()[0]["id"]
    assert db.get_upload_event(eid)["filename"] == "z.pdf"
    assert db.get_upload_event(999999) is None


def test_stats_since(fresh_db):
    db.log_upload_start(
        job_id="j1", paper_id=None, filename="ok.pdf", file_size=1,
        content_hash=None, pdf_path=None,
    )
    db.mark_upload_done("j1")
    db.log_upload_start(
        job_id="j2", paper_id=None, filename="fail.pdf", file_size=1,
        content_hash=None, pdf_path=None,
    )
    db.mark_upload_failed("j2", "RuntimeError", "graph", "nope")
    stats = db.upload_stats_since("2000-01-01T00:00:00+00:00")
    assert stats["total"] == 2
    assert stats["by_status"]["done"] == 1
    assert stats["by_status"]["error"] == 1
    assert len(stats["failures"]) == 1
    assert stats["failures"][0]["filename"] == "fail.pdf"
    # A future cutoff excludes everything.
    assert db.upload_stats_since("2999-01-01T00:00:00+00:00")["total"] == 0


# ---------- notify (email no-op when unconfigured) ----------

def test_send_email_noop_without_smtp(monkeypatch):
    monkeypatch.delenv("SMTP_USER", raising=False)
    monkeypatch.delenv("SMTP_PASSWORD", raising=False)
    assert notify.smtp_configured() is False
    assert notify.send_email("subj", "body") is False  # no exception, just skipped


def test_notify_upload_failure_noop_without_smtp(monkeypatch):
    monkeypatch.delenv("SMTP_USER", raising=False)
    monkeypatch.delenv("SMTP_PASSWORD", raising=False)
    # Must not raise even with a minimal event dict.
    notify.notify_upload_failure({"filename": "x.pdf", "error_type": "E"})


# ---------- admin API auth ----------

@pytest.fixture
def client(fresh_db, monkeypatch):
    from fastapi.testclient import TestClient
    import main
    return TestClient(main.app)


def test_admin_disabled_without_token_env(client, monkeypatch):
    monkeypatch.delenv("ADMIN_TOKEN", raising=False)
    r = client.get("/api/admin/uploads")
    assert r.status_code == 503


def test_admin_wrong_token(client, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "secret")
    r = client.get("/api/admin/uploads", headers={"X-Admin-Token": "nope"})
    assert r.status_code == 401


def test_admin_correct_token(client, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "secret")
    db.log_upload_start(
        job_id="job:a", paper_id="paper:a", filename="ok.pdf", file_size=1,
        content_hash=None, pdf_path=None,
    )
    r = client.get("/api/admin/uploads", headers={"X-Admin-Token": "secret"})
    assert r.status_code == 200
    assert r.json()["items"][0]["filename"] == "ok.pdf"
