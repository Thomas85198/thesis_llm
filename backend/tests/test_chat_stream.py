"""Tests for the persisted, streaming paper-chat assistant.

不觸網、不碰 LLM：stream 一律 monkeypatch llm.stream_completion。
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import chat as chat_mod
from app import db, llm
from main import app

client = TestClient(app)

PID = "paper:chat01"


@pytest.fixture()
def paper_with_result():
    db.upsert_paper(PID, "測試論文", "t.pdf", "hash-chat", "t.pdf")
    db.upsert_result(
        PID,
        {"paper_id": PID, "graph": {"edus": []}, "defects": [], "rule_meta": []},
    )
    return PID


def _sse_events(text: str) -> list[str]:
    return [
        line.strip()[5:].strip()
        for line in text.split("\n\n")
        if line.strip().startswith("data:")
    ]


# ---------- db layer ----------


def test_chat_messages_roundtrip_and_prune(monkeypatch):
    monkeypatch.setattr(db, "MAX_CHAT_MESSAGES_PER_PAPER", 4)
    for i in range(6):
        db.add_chat_message("paper:p1", "user" if i % 2 == 0 else "assistant", f"m{i}")
    msgs = db.get_chat_messages("paper:p1")
    assert [m["content"] for m in msgs] == ["m2", "m3", "m4", "m5"]  # 最舊被修剪
    db.clear_chat_messages("paper:p1")
    assert db.get_chat_messages("paper:p1") == []


def test_delete_paper_cascades_chat(paper_with_result):
    db.add_chat_message(PID, "user", "hi")
    db.delete_paper(PID)
    assert db.get_chat_messages(PID) == []


# ---------- stream route ----------


def test_stream_happy_path_persists_both_turns(paper_with_result, monkeypatch):
    def fake_stream(**kwargs):
        yield "你好，"
        yield "這篇論文在講 [EDU:e1]。"

    monkeypatch.setattr(llm, "stream_completion", fake_stream)
    res = client.post(
        f"/api/papers/{PID}/chat/stream", json={"message": "這篇在講什麼？"}
    )
    assert res.status_code == 200
    events = _sse_events(res.text)
    assert events[-1] == "[DONE]"
    assert '"t"' in events[0]

    msgs = db.get_chat_messages(PID)
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[1]["content"] == "你好，這篇論文在講 [EDU:e1]。"

    # GET 歷史 = 前端重整後看到的內容
    hist = client.get(f"/api/papers/{PID}/chat").json()["messages"]
    assert len(hist) == 2 and hist[0]["content"] == "這篇在講什麼？"


def test_stream_midway_error_rolls_back_user_turn(paper_with_result, monkeypatch):
    def broken_stream(**kwargs):
        yield "開頭"
        raise RuntimeError("boom")

    monkeypatch.setattr(llm, "stream_completion", broken_stream)
    res = client.post(f"/api/papers/{PID}/chat/stream", json={"message": "嗨"})
    events = _sse_events(res.text)
    assert any('"error"' in e for e in events)
    assert events[-1] == "[DONE]"
    assert db.get_chat_messages(PID) == []  # user turn 已回滾，重試不會重複


def test_stream_sends_truncated_history(paper_with_result, monkeypatch):
    # 種 30 則歷史（15 輪），送 LLM 的 history+user 應被截到 MAX_HISTORY_TURNS*2
    for i in range(30):
        db.add_chat_message(PID, "user" if i % 2 == 0 else "assistant", f"m{i}")
    captured: dict = {}

    def spy_stream(**kwargs):
        captured.update(kwargs)
        yield "ok"

    monkeypatch.setattr(llm, "stream_completion", spy_stream)
    res = client.post(f"/api/papers/{PID}/chat/stream", json={"message": "新問題"})
    assert res.status_code == 200
    total = len(captured["history"]) + 1
    assert total <= chat_mod.MAX_HISTORY_TURNS * 2
    assert captured["user_content"] == "新問題"
    # 歷史最尾端是最近的訊息
    assert captured["history"][-1]["content"] == "m29"


def test_stream_validation_and_guards(paper_with_result, monkeypatch):
    assert (
        client.post(
            f"/api/papers/{PID}/chat/stream", json={"message": "  "}
        ).status_code
        == 400
    )
    too_long = "x" * (chat_mod.MAX_USER_INPUT_CHARS + 1)
    assert (
        client.post(
            f"/api/papers/{PID}/chat/stream", json={"message": too_long}
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/papers/paper:nope/chat/stream", json={"message": "hi"}
        ).status_code
        == 404
    )
    # 尚未有分析結果 → 409
    db.upsert_paper("paper:noresult", "t", "t.pdf", "h2", "t.pdf")
    assert (
        client.post(
            "/api/papers/paper:noresult/chat/stream", json={"message": "hi"}
        ).status_code
        == 409
    )


def test_stream_rate_limited_429(paper_with_result, monkeypatch):
    monkeypatch.setattr(chat_mod, "RATE_LIMIT_PER_MIN", 1)
    monkeypatch.setattr(chat_mod, "_rate_buckets", {})

    def fake_stream(**kwargs):
        yield "ok"

    monkeypatch.setattr(llm, "stream_completion", fake_stream)
    assert (
        client.post(
            f"/api/papers/{PID}/chat/stream", json={"message": "一"}
        ).status_code
        == 200
    )
    res = client.post(f"/api/papers/{PID}/chat/stream", json={"message": "二"})
    assert res.status_code == 429


def test_history_endpoints(paper_with_result):
    assert client.get("/api/papers/paper:nope/chat").status_code == 404
    assert client.get(f"/api/papers/{PID}/chat").json() == {"messages": []}
    db.add_chat_message(PID, "user", "q")
    assert len(client.get(f"/api/papers/{PID}/chat").json()["messages"]) == 1
    assert client.delete(f"/api/papers/{PID}/chat").json() == {"ok": True}
    assert client.get(f"/api/papers/{PID}/chat").json() == {"messages": []}
