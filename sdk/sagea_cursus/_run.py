"""Run object + module-level singleton wiring (PRD §8.1).

Global ``init/log/finish`` mirror wandb ergonomics; everything else
(batching, retry, heartbeat) is private.
"""

from __future__ import annotations

import threading
import warnings
from datetime import datetime, timezone
from typing import Any

from ._batching import Batcher
from ._client import CursusClient

HEARTBEAT_INTERVAL_S = 30.0


class RunConfig(dict):
    """Mutable run config, updatable mid-run (``cursus.config.update(...)``)."""

    def update(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        super().update(*args, **kwargs)


class Run:
    """A live training run. Prefer module-level init/log/finish."""

    def __init__(
        self,
        client: CursusClient,
        run_id: str,
        name: str,
        url: str,
        config: dict[str, Any] | None = None,
    ) -> None:
        self._client = client
        self.id = run_id
        self.name = name
        self.url = url
        self.config = RunConfig(config or {})
        self._batcher = Batcher(send=lambda pts: self._client.log_batch(self.id, pts))
        self._finished = False
        self._hb_stop = threading.Event()
        self._hb_thread = threading.Thread(
            target=self._heartbeat_loop, name="cursus-hb", daemon=True
        )
        self._batcher.start()
        self._hb_thread.start()

    def log(self, data: dict[str, float], step: int | None = None) -> None:
        """Queue metric points. Never raises into user code."""
        if self._finished:
            warnings.warn("cursus: log() called after finish(); ignoring.")
            return
        if step is None:
            warnings.warn("cursus: log() without step; using 0.")
            step = 0
        wall = datetime.now(timezone.utc).isoformat()
        try:
            points = [
                {"key": k, "step": int(step), "value": float(v), "wall_time": wall}
                for k, v in data.items()
            ]
        except (TypeError, ValueError) as exc:
            warnings.warn(f"cursus: invalid log() data dropped: {exc}")
            return
        try:
            self._batcher.enqueue(points)
        except Exception as exc:  # noqa: BLE001 — never block training
            warnings.warn(f"cursus: log() failed (dropped): {exc}")

    def finish(self, status: str = "finished") -> None:
        if self._finished:
            return
        self._finished = True
        self._hb_stop.set()
        try:
            self._batcher.close()
        finally:
            try:
                self._client.finish_run(self.id, status=status)
            except Exception as exc:  # noqa: BLE001 — never crash training
                warnings.warn(f"cursus: finish() failed: {exc}")

    def _heartbeat_loop(self) -> None:
        while not self._hb_stop.wait(HEARTBEAT_INTERVAL_S):
            try:
                self._client.heartbeat(self.id)
            except Exception:  # noqa: BLE001,S112 — heartbeat is best-effort
                continue


_lock = threading.Lock()
_current: Run | None = None


def _get_current() -> Run | None:
    return _current


def _set_current(run: Run | None) -> None:
    global _current
    with _lock:
        _current = run


def _clear_current() -> None:
    _set_current(None)
