"""Integration: SDK ↔ real server. Opt-in (needs a live server + key).

Run: RUN_CURSUS_INTEGRATION=1 CURSUS_API_KEY=... CURSUS_BASE_URL=... pytest -m integration
Catches drift between SDK expectations and actual server behavior — the thing
mocked unit tests can't catch.
"""

from __future__ import annotations

import os

import pytest

requests = pytest.importorskip("requests")

pytestmark = pytest.mark.integration

BASE_URL = os.environ.get("CURSUS_BASE_URL", "http://localhost:3000")
API_KEY = os.environ.get("CURSUS_API_KEY")


@pytest.mark.skipif(
    not os.environ.get("RUN_CURSUS_INTEGRATION"),
    reason="opt-in: set RUN_CURSUS_INTEGRATION=1 with a live server",
)
def test_init_log_finish_roundtrip() -> None:
    import sagea_cursus as cursus

    assert API_KEY, "CURSUS_API_KEY must be set for integration tests"
    run = cursus.init(
        project="sdk-integration",
        config={"lr": 0.001},
        name="integration-run",
        api_key=API_KEY,
        base_url=BASE_URL,
    )
    try:
        for step in range(10):
            cursus.log({"train/loss": 1.0 / (step + 1)}, step=step)
    finally:
        cursus.finish()
    assert run.id

    resp = requests.get(
        f"{BASE_URL}/api/v1/runs/{run.id}/metrics",
        params={"key": "train/loss"},
        headers={"Authorization": f"Bearer {API_KEY}"},
        timeout=10,
    )
    assert resp.status_code == 200
    points = resp.json()["points"]
    assert len(points) == 10
    assert points[0]["step"] == 0
