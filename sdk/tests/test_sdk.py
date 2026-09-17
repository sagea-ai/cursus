"""Unit tests: no real network (mocked transport), fast."""

from __future__ import annotations

import warnings

import sagea_cursus as cursus
from sagea_cursus import _run as run_mod
from sagea_cursus._batching import Batcher
from sagea_cursus._client import resolve_base_url


class FakeClient:
    def __init__(self, fail_times: int = 0) -> None:
        self.batches: list = []
        self.fail_times = fail_times
        self.calls = 0

    def log_batch(self, run_id: str, points: list) -> None:
        self.calls += 1
        if self.calls <= self.fail_times:
            raise ConnectionError("boom")
        self.batches.append(list(points))

    def finish_run(self, run_id: str, status: str = "finished") -> None:
        self.finished = (run_id, status)

    def heartbeat(self, run_id: str) -> None:
        pass


def test_public_surface_is_barebones() -> None:
    assert sorted(cursus.__all__) == ["config", "finish", "init", "log"]


def test_batcher_flushes_on_max_points() -> None:
    fake = FakeClient()
    b = Batcher(
        send=lambda pts: fake.log_batch("run", pts),
        flush_interval=60,
        max_points=3,
    )
    b.enqueue([{"key": "a", "step": 0, "value": 1.0}])
    assert fake.batches == []
    b.enqueue([{"key": "a", "step": 1, "value": 2.0}])
    b.enqueue([{"key": "a", "step": 2, "value": 3.0}])
    assert len(fake.batches) == 1
    assert len(fake.batches[0]) == 3
    b.close()


def test_batcher_warns_and_drops_after_bounded_retries() -> None:
    fake = FakeClient(fail_times=100)
    b = Batcher(
        send=lambda pts: fake.log_batch("run", pts),
        flush_interval=60,
        max_points=100,
        max_retries=2,
    )
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        b.enqueue([{"key": "a", "step": 0, "value": 1.0}])
        b.flush()
    assert any("dropped" in str(w.message) for w in caught)
    b.close()


def test_log_never_raises_even_when_transport_explodes() -> None:
    """PRD §8.1 named guarantee: logging must never block/crash training."""
    fake = FakeClient(fail_times=1000)
    real = run_mod.Run.__new__(run_mod.Run)
    real._finished = False
    real._batcher = Batcher(
        send=lambda pts: fake.log_batch("run", pts),
        flush_interval=60,
        max_points=100,
        max_retries=1,
    )
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for i in range(5):  # must not raise
            real.log({"train/loss": 0.5}, step=i)
        real._batcher.close()


def test_resolve_base_url_precedence(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.delenv("CURSUS_API_KEY", raising=False)
    monkeypatch.delenv("CURSUS_BASE_URL", raising=False)
    assert resolve_base_url() == "http://localhost:3000"
    monkeypatch.setenv("CURSUS_BASE_URL", "https://example.com/")
    assert resolve_base_url() == "https://example.com"
