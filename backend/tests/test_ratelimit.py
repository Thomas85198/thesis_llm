"""Shared sliding-window limiter (app/ratelimit.py).

The per-feature behaviors (limits, monkeypatched buckets) are still covered by
each feature's own tests; here we cover the shared algorithm plus the one new
behavior the copies lacked: stale buckets get dropped instead of growing
forever.
"""

from __future__ import annotations

import threading
import time

from app import ratelimit


def _fresh():
    return {}, threading.Lock()


def test_allows_until_limit_then_reports_wait():
    buckets, lock = _fresh()

    assert ratelimit.check(buckets, lock, 2, "d") == (True, 0)
    assert ratelimit.check(buckets, lock, 2, "d") == (True, 0)
    allowed, wait = ratelimit.check(buckets, lock, 2, "d")

    assert allowed is False
    assert 1 <= wait <= 60


def test_keys_are_independent():
    buckets, lock = _fresh()

    assert ratelimit.check(buckets, lock, 1, "a")[0] is True
    assert ratelimit.check(buckets, lock, 1, "a")[0] is False
    assert ratelimit.check(buckets, lock, 1, "b")[0] is True


def test_expired_entries_free_the_slot():
    buckets, lock = _fresh()
    buckets["d"] = [time.time() - ratelimit.WINDOW_SECONDS - 1]

    assert ratelimit.check(buckets, lock, 1, "d")[0] is True


def test_stale_buckets_are_dropped():
    buckets, lock = _fresh()
    buckets["old"] = [time.time() - ratelimit.WINDOW_SECONDS - 1]
    buckets["empty"] = []

    ratelimit.check(buckets, lock, 5, "fresh")

    assert set(buckets) == {"fresh"}
