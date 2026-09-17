"""Public SDK surface: init, log, finish, config. Nothing else is public.

``__all__`` enforces the barebones contract (PRD §8.2) — everything else is
underscore-prefixed and private.
"""

from __future__ import annotations

import warnings
from typing import Any

from ._client import CursusClient
from ._run import Run, _clear_current, _get_current, _set_current

__all__ = ["config", "finish", "init", "log"]

config: dict[str, Any] = {}


def init(
    project: str,
    config: dict[str, Any] | None = None,
    name: str | None = None,
    tags: list[str] | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
) -> Run:
    """Create a run on the server and set the module-level singleton.

    Reads the API key from ``api_key`` > ``CURSUS_API_KEY`` env >
    ``~/.cursus/config``. Fails loudly on version mismatch or missing key —
    init is the one place raising is acceptable; log/finish never raise.

    Example:
        import sagea_cursus as cursus
        run = cursus.init(project="demo", config={"lr": 1e-4})
        cursus.log({"train/loss": 0.4}, step=1)
        cursus.finish()
    """
    client = CursusClient(api_key=api_key, base_url=base_url)
    if not client.api_key:
        raise RuntimeError(
            "Missing Cursus API key. Set CURSUS_API_KEY, pass api_key=..., "
            "or write ~/.cursus/config."
        )
    client.check_version()
    prev = _get_current()
    if prev is not None:
        warnings.warn("cursus: init() called twice; finishing previous run.")
        try:
            prev.finish()
        except Exception:  # noqa: BLE001,S110 — previous run must not break init
            pass
    payload = client.create_run(project=project, name=name, config=config or {}, tags=tags or [])
    run = Run(
        client=client,
        run_id=str(payload["run_id"]),
        name=str(payload.get("name", "")),
        url=str(payload.get("url", "")),
        config=dict(config or {}),
    )
    _set_current(run)
    globals()["config"] = run.config
    return run


def log(data: dict[str, float], step: int | None = None) -> None:
    """Log a dict of scalars. Warns + drops on failure; never raises."""
    run = _get_current()
    if run is None:
        warnings.warn("cursus: log() called before init(); ignoring.")
        return
    run.log(data, step=step)


def finish(status: str = "finished") -> None:
    """Flush + mark the current run finished. Never raises."""
    run = _get_current()
    if run is None:
        return
    try:
        run.finish(status=status)
    finally:
        _clear_current()
