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
    assert sorted(cursus.__all__) == [
        "config",
        "create_sweep",
        "finish",
        "init",
        "log",
        "log_artifact",
        "log_image",
        "next_trial",
    ]


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
    """Core guarantee: logging must never block/crash training."""
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


def test_log_artifact_warns_without_a_run() -> None:
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        assert cursus.log_artifact("m", ["nope.bin"]) is None
    assert any("before init" in str(w.message) for w in caught)


def test_log_artifact_uploads_and_never_raises(tmp_path) -> None:  # type: ignore[no-untyped-def]
    from sagea_cursus._client import CursusClient

    weights = tmp_path / "best.pt"
    weights.write_bytes(b"fake-bytes")

    sent: dict = {}

    class FakeSession:
        def post(self, url, data=None, files=None, timeout=None):
            sent.update(url=url, data=data, files=files)

            class Resp:
                def raise_for_status(self):
                    pass

                def json(self):
                    return {"ok": True}

            return Resp()

    client = CursusClient(api_key="cursus_test", base_url="http://x")
    client._session = FakeSession()  # type: ignore[method-assign]
    out = client.create_artifact_version(name="m", files=[("best.pt", b"fake-bytes")], run_id="r1")
    assert out == {"ok": True}
    assert sent["url"].endswith("/api/v1/artifacts")
    assert sent["data"]["run_id"] == "r1"
    assert sent["files"][0][0] == "files"

    # Missing files warn instead of raising (with a run set so we reach them).
    from types import SimpleNamespace

    class FakeUploader:
        def create_artifact_version(self, **kwargs):
            raise AssertionError("should not be called without files")

    run_mod._set_current(SimpleNamespace(id="r", _client=FakeUploader()))
    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert cursus.log_artifact("m", [str(tmp_path / "gone.bin")]) is None
        assert any("no readable files" in str(w.message) for w in caught)
    finally:
        run_mod._set_current(None)


def test_resolve_base_url_precedence(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.delenv("CURSUS_API_KEY", raising=False)
    monkeypatch.delenv("CURSUS_BASE_URL", raising=False)
    assert resolve_base_url() == "http://localhost:3000"
    monkeypatch.setenv("CURSUS_BASE_URL", "https://example.com/")
    assert resolve_base_url() == "https://example.com"


PNG_1PX = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
    b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_encode_image_sniffs_bytes_and_paths(tmp_path) -> None:
    from sagea_cursus._media import encode_image

    data, mime = encode_image(PNG_1PX)
    assert mime == "image/png" and data == PNG_1PX
    p = tmp_path / "a.png"
    p.write_bytes(PNG_1PX)
    assert encode_image(str(p)) == (PNG_1PX, "image/png")
    try:
        encode_image(b"not-an-image")
    except ValueError as exc:
        assert "not PNG/JPEG/WEBP" in str(exc)
    else:
        raise AssertionError("expected ValueError")
    try:
        encode_image(12345)
    except TypeError as exc:
        assert "takes a path, bytes" in str(exc)
    else:
        raise AssertionError("expected TypeError")


def test_log_image_success_warns_never_and_completes(monkeypatch) -> None:
    from types import SimpleNamespace

    puts = []

    class FakeResp:
        def raise_for_status(self) -> None:
            pass

    monkeypatch.setattr(
        cursus.requests, "put", lambda url, **kw: puts.append((url, kw)) or FakeResp()
    )

    class FakeMediaClient:
        def request_upload_url(self, run_id, key, step, mime, size):
            assert (run_id, key, step, mime, size) == ("r", "k", 3, "image/png", len(PNG_1PX))
            return {"mediaId": "m1", "url": "http://put/here"}

        def complete_upload(self, run_id, media_id):
            assert (run_id, media_id) == ("r", "m1")
            return {"id": "m1", "key": "k", "step": 3}

    run_mod._set_current(SimpleNamespace(id="r", _client=FakeMediaClient()))
    try:
        out = cursus.log_image("k", PNG_1PX, step=3)
        assert out == {"id": "m1", "key": "k", "step": 3}
        assert puts and puts[0][0] == "http://put/here"
    finally:
        run_mod._set_current(None)


def test_log_image_drops_oversize_and_failures(monkeypatch, tmp_path) -> None:
    from types import SimpleNamespace

    # Bound at import into the cursus namespace — patch the use site.
    monkeypatch.setattr(cursus, "_MAX_IMAGE_BYTES", 4)

    class ExplodingClient:
        def request_upload_url(self, *a):
            raise ConnectionError("down")

    run_mod._set_current(SimpleNamespace(id="r", _client=ExplodingClient()))
    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert cursus.log_image("k", PNG_1PX, step=0) is None
            assert cursus.log_image("k", str(tmp_path / "missing.png"), step=0) is None
        assert any("5 MB" in str(w.message) or "exceeds" in str(w.message) for w in caught)
        assert any("bad input" in str(w.message) for w in caught)
    finally:
        run_mod._set_current(None)


def test_sweep_create_and_next_trial(monkeypatch) -> None:
    calls = {}

    class FakeSweepClient:
        def __init__(self, api_key=None, base_url=None):
            self.api_key = api_key or "k"

        def check_version(self) -> None:
            pass

        def create_sweep(self, project, name, method, space):
            calls["create"] = {
                "project": project,
                "name": name,
                "method": method,
                "space": space,
            }
            return {"id": "sw1", "name": name}

        def next_trial(self, sweep_id):
            calls["next"] = sweep_id
            return {"trial": 0, "config": {"lr": 0.1}, "sweep_id": sweep_id}

    monkeypatch.setattr(cursus, "CursusClient", FakeSweepClient)
    sw = cursus.create_sweep("p", {"lr": {"values": [0.1, 0.2]}}, api_key="k")
    assert sw["id"] == "sw1"
    assert calls["create"]["method"] == "RANDOM"
    trial = cursus.next_trial("sw1", api_key="k")
    assert trial == {"trial": 0, "config": {"lr": 0.1}, "sweep_id": "sw1"}


def test_next_trial_204_means_exhausted() -> None:
    from types import SimpleNamespace

    from sagea_cursus._client import CursusClient

    class Gone:
        status_code = 204

        def raise_for_status(self) -> None:
            raise AssertionError("must not raise on 204")

    client = CursusClient(api_key="k")
    client._session = SimpleNamespace(post=lambda *a, **k: Gone())
    assert client.next_trial("sw1") is None


def test_config_update_debounces_and_flushes(monkeypatch) -> None:
    import time

    from sagea_cursus import _run as run_mod

    monkeypatch.setattr(run_mod, "CONFIG_SYNC_DEBOUNCE_S", 0.05)
    synced = []
    cfg = run_mod.RunConfig({"lr": 0.1})
    cfg._sync = synced.append
    cfg.update({"lr": 0.2})
    cfg.update({"lr": 0.3})
    cfg.update({"epochs": 5})
    time.sleep(0.25)
    assert synced == [{"lr": 0.3, "epochs": 5}]

    cfg.update({"lr": 0.4})
    cfg.flush()
    assert synced[-1] == {"lr": 0.4, "epochs": 5}

    def boom(snapshot):
        raise ConnectionError("down")

    cfg._sync = boom
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        cfg.flush()
    assert any("config sync failed" in str(w.message) for w in caught)
