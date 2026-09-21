"""Run object + module-level singleton wiring.

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
from ._system import SystemMonitor

HEARTBEAT_INTERVAL_S = 30.0
# Trailing debounce for mid-run config syncs: rapid update() bursts cost
# one PATCH, and finish() flushes so the final config always lands.
CONFIG_SYNC_DEBOUNCE_S = 5.0


class RunConfig(dict):
    """Run config, synced to the server (debounced) on mid-run updates."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self._sync: Any = None
        self._timer: threading.Timer | None = None
        self._timer_lock = threading.Lock()
        super().__init__(*args, **kwargs)

    def update(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        super().update(*args, **kwargs)
        self._schedule_sync()

    def _schedule_sync(self) -> None:
        if self._sync is None:
            return
        with self._timer_lock:
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(CONFIG_SYNC_DEBOUNCE_S, self.flush)
            self._timer.daemon = True
            self._timer.start()

    def flush(self) -> None:
        with self._timer_lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
        if self._sync is None:
            return
        try:
            self._sync(dict(self))
        except Exception as exc:  # noqa: BLE001 — never crash training
            warnings.warn(f"cursus: config sync failed (dropped): {exc}")


class Run:
    """A live training run. Prefer module-level init/log/finish."""

    def __init__(
        self,
        client: CursusClient,
        run_id: str,
        name: str,
        url: str,
        config: dict[str, Any] | None = None,
        monitor: bool = True,
    ) -> None:
        self._client = client
        self.id = run_id
        self.name = name
        self.url = url
        self._last_step = 0
        self.config = RunConfig(config or {})
        self.config._sync = lambda cfg: self._client.update_config(self.id, cfg)
        self._batcher = Batcher(send=lambda pts: self._client.log_batch(self.id, pts))
        self._log_batcher = Batcher(send=lambda lines: self._client.log_text_batch(self.id, lines))
        self._monitor = (
            SystemMonitor(
                send=lambda pts: self._batcher.enqueue(pts),
                get_step=lambda: self._last_step,
            )
            if monitor
            else None
        )
        self._finished = False
        self._hb_stop = threading.Event()
        self._hb_thread = threading.Thread(
            target=self._heartbeat_loop, name="cursus-hb", daemon=True
        )
        self._batcher.start()
        self._log_batcher.start()
        if self._monitor is not None:
            self._monitor.start()
        self._hb_thread.start()

    def log(self, data: dict[str, float], step: int | None = None) -> None:
        """Queue metric points. Never raises into user code."""
        if self._finished:
            warnings.warn("cursus: log() called after finish(); ignoring.")
            return
        if step is None:
            warnings.warn("cursus: log() without step; using 0.")
            step = 0
        try:
            self._last_step = int(step)
        except (TypeError, ValueError):
            pass
        # Z-suffixed UTC: unambiguous for every server parser (Zod, Go, etc.).
        wall = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
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

    def log_text(self, text: str, stream: str = "stdout", step: int | None = None) -> None:
        """Queue log lines. Splits multi-line input; never raises."""
        if self._finished:
            warnings.warn("cursus: log_text() called after finish(); ignoring.")
            return
        if stream not in ("stdout", "stderr"):
            warnings.warn(f"cursus: invalid log stream {stream!r}; using stdout.")
            stream = "stdout"
        try:
            lines = [
                {
                    "stream": stream,
                    "step": int(step) if step is not None else None,
                    "text": line,
                }
                for line in str(text).splitlines()
                if line.strip()
            ]
        except (TypeError, ValueError) as exc:
            warnings.warn(f"cursus: invalid log_text() data dropped: {exc}")
            return
        if not lines:
            return
        try:
            self._log_batcher.enqueue(lines)
        except Exception as exc:  # noqa: BLE001 — never block training
            warnings.warn(f"cursus: log_text() failed (dropped): {exc}")

    def finish(self, status: str = "finished") -> None:
        if self._finished:
            return
        self._finished = True
        self._hb_stop.set()
        if self._monitor is not None:
            self._monitor.stop()
        try:
            self._batcher.close()
            self._log_batcher.close()
        finally:
            try:
                # Final config lands before the status flips (finished
                # runs are immutable server-side).
                self.config.flush()
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
