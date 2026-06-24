"""Route-level test for the version-restore endpoint (self-cleaning integration
test against the app, mirroring test_editor_upload's style)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def _doc(text: str) -> dict:
    return {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
    }


def _text(content_json: dict) -> str:
    return content_json["content"][0]["content"][0]["text"]


def test_restore_backs_up_current_then_restores():
    did = client.post(
        "/api/editor/documents",
        json={"title": "restore test", "locale": "zh-Hant", "content_json": _doc("B")},
    ).json()["doc_id"]
    try:
        vid = client.post(
            f"/api/editor/documents/{did}/versions",
            json={"content_json": _doc("A"), "label": "v1"},
        ).json()["version_id"]

        # Restore to v1 → returns A, and the document now holds A.
        res = client.post(f"/api/editor/documents/{did}/restore/{vid}")
        assert res.status_code == 200
        assert _text(res.json()["content_json"]) == "A"
        assert (
            _text(client.get(f"/api/editor/documents/{did}").json()["content_json"])
            == "A"
        )

        # The pre-restore content (B) was snapshotted as a restore-backup.
        versions = client.get(f"/api/editor/documents/{did}/versions").json()
        backups = [v for v in versions if v["label"] == "restore-backup"]
        assert len(backups) == 1
        backup = client.get(
            f"/api/editor/documents/{did}/versions/{backups[0]['id']}"
        ).json()
        assert _text(backup["content_json"]) == "B"

        # Unknown version id → 404.
        assert (
            client.post(f"/api/editor/documents/{did}/restore/999999").status_code
            == 404
        )
    finally:
        client.delete(f"/api/editor/documents/{did}")


def test_optimistic_concurrency_rejects_stale_update():
    created = client.post(
        "/api/editor/documents",
        json={"title": "concurrency", "locale": "zh-Hant", "content_json": _doc("v0")},
    ).json()
    did = created["doc_id"]
    try:
        # A matching token saves and returns the new updated_at.
        r1 = client.put(
            f"/api/editor/documents/{did}",
            json={
                "content_json": _doc("v1"),
                "expected_updated_at": created["updated_at"],
            },
        )
        assert r1.status_code == 200
        new_ts = r1.json()["updated_at"]
        assert new_ts and new_ts != created["updated_at"]

        # Re-sending the *old* token now conflicts (another writer moved it on).
        r2 = client.put(
            f"/api/editor/documents/{did}",
            json={
                "content_json": _doc("v2"),
                "expected_updated_at": created["updated_at"],
            },
        )
        assert r2.status_code == 409
        assert r2.json()["detail"]["updated_at"] == new_ts

        # No token → unconditional save still works (force-overwrite path).
        r3 = client.put(
            f"/api/editor/documents/{did}", json={"content_json": _doc("v3")}
        )
        assert r3.status_code == 200
        cur = client.get(f"/api/editor/documents/{did}").json()
        assert _text(cur["content_json"]) == "v3"
    finally:
        client.delete(f"/api/editor/documents/{did}")
