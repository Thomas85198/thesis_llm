"""Global test isolation: every test runs against a throwaway SQLite file and
a throwaway upload dir.

Without this, route-level tests using TestClient(app) wrote rows into the real
backend/data.db (draft_check_cache pollution then flipped later runs to cache
hits) and leaked img_*.png files into backend/uploads/.
"""

from __future__ import annotations

import importlib

import pytest

from app import db


@pytest.fixture(autouse=True)
def _isolate_storage(tmp_path, monkeypatch):
    # SQLite → temp file, force schema re-init for this test.
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(db, "_initialized", False)

    # Upload dir → temp dir. routes.UPLOAD_DIR is resolved at import time, so
    # patch the module attribute as well as the env var (import_doc reads the
    # env lazily via _upload_dir()).
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    monkeypatch.setenv("UPLOAD_DIR", str(upload_dir))
    try:
        from app import routes

        monkeypatch.setattr(routes, "UPLOAD_DIR", upload_dir)
    except Exception:  # pragma: no cover — routes import may fail in stubs
        pass

    yield

    importlib.reload(db)  # restore module-level DB_PATH for any later import
