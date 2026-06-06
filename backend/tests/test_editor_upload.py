"""Tests for editor-mode image upload + serving."""
from __future__ import annotations

import base64

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

# A real 1x1 transparent PNG.
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def test_upload_then_serve_roundtrip():
    res = client.post(
        "/api/editor/upload",
        files={"file": ("pic.png", PNG_1PX, "image/png")},
    )
    assert res.status_code == 200
    url = res.json()["url"]
    assert url.startswith("/api/editor/images/img_") and url.endswith(".png")

    got = client.get(url)
    assert got.status_code == 200
    assert got.content == PNG_1PX  # served bytes match what we uploaded


def test_upload_rejects_non_image_extension():
    res = client.post(
        "/api/editor/upload",
        files={"file": ("evil.exe", b"MZ...", "application/octet-stream")},
    )
    assert res.status_code == 415


def test_serve_missing_image_404():
    assert client.get("/api/editor/images/img_doesnotexist.png").status_code == 404
