"""Public SDK surface: init, log, finish, log_artifact, config.

``__all__`` enforces the barebones contract (PRD §8.2) — everything else is
underscore-prefixed and private.
"""

from __future__ import annotations

import warnings
from os import PathLike
from pathlib import Path
from typing import Any

from ._client import CursusClient
from ._run import Run, _clear_current, _get_current, _set_current

__all__ = ["config", "finish", "init", "log", "log_artifact"]

config: dict[str, Any] = {}


def init(
    project: str,
    config: dict[str, Any] | None = None,
    name: str | None = None,
    tags: list[str] | None = None,
    group: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
) -> Run:
    """Create a run on the server and set the module-level singleton.

    Reads the API key from ``api_key`` > ``CURSUS_API_KEY`` env >
    ``~/.cursus/config``. Fails loudly on version mismatch or missing key —
    init is the one place raising is acceptable; log/finish never raise.

    Pass ``group="slug"`` to log into a project inside that group (the
    project is resolved or created there; you must belong to the group).
    Omit it for org-wide projects visible to every member.

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
    payload = client.create_run(
        project=project,
        name=name,
        config=config or {},
        tags=tags or [],
        group=group,
    )
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


def log_artifact(
    name: str,
    paths: str | PathLike[str] | list[str | PathLike[str]],
    type: str = "model",
    description: str = "",
) -> dict[str, Any] | None:
    """Attach files to the current run as a new artifact version.

    Example:
        cursus.log_artifact("yolov8m", "runs/train/weights/best.pt",
                            type="model", description="map50: 0.61")

    Warns + skips on failure (missing files, network); never raises into
    user code. Returns the created version payload, or None when skipped.
    """
    run = _get_current()
    if run is None:
        warnings.warn("cursus: log_artifact() called before init(); ignoring.")
        return None
    if isinstance(paths, (str, PathLike)):
        paths = [paths]
    files: list[tuple[str, bytes]] = []
    for p in paths:
        try:
            content = Path(p).read_bytes()
        except OSError as exc:
            warnings.warn(f"cursus: log_artifact() skipping unreadable {p}: {exc}")
            continue
        files.append((Path(p).name, content))
    if not files:
        warnings.warn("cursus: log_artifact() found no readable files; skipping.")
        return None
    try:
        # Same-package access to the run's client (the one funnel, §8.2).
        return run._client.create_artifact_version(
            name=name,
            files=files,
            run_id=run.id,
            artifact_type=type,
            description=description,
        )
    except Exception as exc:  # noqa: BLE001 — never crash training
        warnings.warn(f"cursus: log_artifact() failed (dropped): {exc}")
        return None
