"""Concurrency tests for the lazily-initialized singletons.

The section/rule fan-out (up to OPENAI_MAX_WORKERS threads) can hit client()
and driver() for the very first time concurrently. Double-checked locking must
ensure exactly one instance is built no matter how many threads race in. A
threading.Barrier releases all workers at the same instant to maximise the
race window.
"""
from __future__ import annotations

import threading

import app.kg as kg
import app.llm as llm


def _race(call, n=32):
    """Run `call` from n threads released simultaneously; return their results."""
    barrier = threading.Barrier(n)
    results: list[object] = [None] * n

    def worker(i: int) -> None:
        barrier.wait()
        results[i] = call()

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


def test_openai_client_built_once_under_concurrency(monkeypatch):
    created: list[object] = []

    class FakeOpenAI:
        def __init__(self, **kwargs):
            created.append(self)

    monkeypatch.setattr(llm, "OpenAI", FakeOpenAI)
    monkeypatch.setattr(llm, "_client", None)  # force cold start

    results = _race(llm.client)

    assert len(created) == 1  # double-checked lock => built exactly once
    assert all(r is created[0] for r in results)  # everyone shares it


def test_neo4j_driver_built_once_under_concurrency(monkeypatch):
    created: list[object] = []

    def fake_factory(*args, **kwargs):
        d = object()
        created.append(d)
        return d

    monkeypatch.setattr(kg.GraphDatabase, "driver", fake_factory)
    monkeypatch.setattr(kg, "_driver", None)  # force cold start

    results = _race(kg.driver)

    assert len(created) == 1
    assert all(r is created[0] for r in results)
