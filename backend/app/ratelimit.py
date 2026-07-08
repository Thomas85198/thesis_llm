"""Shared sliding-window rate limiting.

Nine editor/analysis modules each carried a copy of the same ~15-line
per-key bucket algorithm. The algorithm lives here once; each module keeps
its own module-level `_rate_buckets` / `_rate_lock` / `RATE_LIMIT_PER_MIN`
so features stay independently tunable (and tests keep monkeypatching those
module attributes directly).

Also fixes the shared flaw of every copy: buckets were never removed, so the
dict grew by one entry per doc_id/paper_id ever seen for the life of the
process. check() now drops fully-expired keys on each call.
"""

from __future__ import annotations

import threading
import time

WINDOW_SECONDS = 60.0


def check(
    buckets: dict[str, list[float]],
    lock: threading.Lock,
    per_min: int,
    key: str,
) -> tuple[bool, int]:
    """Return (allowed, seconds_until_next_slot) over a sliding 60s window."""
    now = time.time()
    with lock:
        stale = [
            k for k, ts in buckets.items() if not ts or now - max(ts) >= WINDOW_SECONDS
        ]
        for k in stale:
            del buckets[k]
        bucket = [t for t in buckets.get(key, []) if now - t < WINDOW_SECONDS]
        if len(bucket) >= per_min:
            wait = max(1, int(WINDOW_SECONDS - (now - min(bucket))))
            buckets[key] = bucket
            return False, wait
        bucket.append(now)
        buckets[key] = bucket
    return True, 0
