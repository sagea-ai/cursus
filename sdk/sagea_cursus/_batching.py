"""Background flush queue — batching logic, unit-testable with a fake client.

PRD §8.1/§9: flush every 5s or every 50 points (whichever first); the server
does one bulk insert per batch. Plain ``threading`` queue + timer — no
asyncio, so this works in every training script including ones without an
event loop.
"""

from __future__ import annotations

import threading
import time
import warnings
from datetime import datetime, timezone
from typing import Any, Callable

FLUSH_INTERVAL_S = 5.0
FLUSH_MAX_POINTS = 50
# Bounded retries on network failure: warn + drop, never raise into user code
# (PRD §6/§8.1 — the single most important SDK reliability property).
MAX_RETRIES = 3


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Batcher:
    """Collects points and flushes them in the background via ``send``."""

    def __init__(
        self,
        send: Callable[[list[dict[str, Any]]], None],
        flush_interval: float = FLUSH_INTERVAL_S,
        max_points: int = FLUSH_MAX_POINTS,
        max_retries: int = MAX_RETRIES,
    ) -> None:
        self._send = send
        self._flush_interval = flush_interval
        self._max_points = max_points
        self._max_retries = max_retries
        self._buf: list[dict[str, Any]] = []
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="cursus-flush", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def enqueue(self, points: list[dict[str, Any]]) -> None:
        should_flush = False
        with self._lock:
            self._buf.extend(points)
            should_flush = len(self._buf) >= self._max_points
        if should_flush:
            self.flush()

    def flush(self) -> None:
        with self._lock:
            batch, self._buf = self._buf, []
        if not batch:
            return
        last_exc: Exception | None = None
        for _ in range(self._max_retries):
            try:
                self._send(batch)
                return
            except Exception as exc:  # noqa: BLE001 — must never propagate
                last_exc = exc
                time.sleep(0.2)
        warnings.warn(
            f"cursus: dropped {len(batch)} metric point(s) after "
            f"{self._max_retries} retries: {last_exc}",
            stacklevel=3,
        )

    def close(self) -> None:
        self._stop.set()
        self.flush()
        if self._thread.is_alive():
            self._thread.join(timeout=5)

    def _loop(self) -> None:
        while not self._stop.wait(self._flush_interval):
            try:
                self.flush()
            except Exception:  # noqa: BLE001,S112 — background thread never dies
                continue
