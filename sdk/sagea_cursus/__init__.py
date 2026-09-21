"""Public SDK surface: init, log, finish, log_artifact, log_image, config.

``__all__`` enforces the minimal contract — everything else is
underscore-prefixed and private.
"""

from __future__ import annotations

import warnings
from os import PathLike
from pathlib import Path
from typing import Any

import requests

from ._client import CursusClient
from ._media import MAX_BYTES as _MAX_IMAGE_BYTES
from ._media import encode_image
from ._run import Run, _clear_current, _get_current, _set_current

__all__ = [
    "config",
    "create_sweep",
    "finish",
    "init",
    "log",
    "log_artifact",
    "log_image",
    "log_text",
    "next_trial",
]

config: dict[str, Any] = {}


def init(
    project: str,
    config: dict[str, Any] | None = None,
    name: str | None = None,
    tags: list[str] | None = None,
    group: str | None = None,
    sweep_id: str | None = None,
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
        sweep_id=sweep_id,
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


def log_text(text: str, stream: str = "stdout", step: int | None = None) -> None:
    """Log stdout/stderr lines. Batched like metrics; never raises."""
    run = _get_current()
    if run is None:
        warnings.warn("cursus: log_text() called before init(); ignoring.")
        return
    run.log_text(text, stream=stream, step=step)


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

    Two-phase upload: the server mints presigned PUT tickets, bytes go
    direct to object storage (no boto — plain requests), then the version
    is completed. No server body limits apply (1 GB per file).

    Example:
        cursus.log_artifact("yolov8m", "runs/train/weights/best.pt",
                            type="model", description="map50: 0.61")

    Warns + skips on failure (missing files, network); never raises into
    user code. Returns the completed version payload, or None when skipped.
    """
    import hashlib

    run = _get_current()
    if run is None:
        warnings.warn("cursus: log_artifact() called before init(); ignoring.")
        return None
    if isinstance(paths, (str, PathLike)):
        paths = [paths]
    specs: list[dict[str, Any]] = []
    blobs: list[bytes] = []
    for p in paths:
        try:
            content = Path(p).read_bytes()
        except OSError as exc:
            warnings.warn(f"cursus: log_artifact() skipping unreadable {p}: {exc}")
            continue
        if not content:
            warnings.warn(f"cursus: log_artifact() skipping empty {p}")
            continue
        specs.append(
            {
                "path": Path(p).name,
                "sizeBytes": len(content),
                "digest": hashlib.sha256(content).hexdigest(),
            }
        )
        blobs.append(content)
    if not specs:
        warnings.warn("cursus: log_artifact() found no readable files; skipping.")
        return None
    try:
        # Same-package access to the run's client (the one funnel).
        ticket = run._client.request_artifact_upload(
            name=name,
            files=specs,
            run_id=run.id,
            artifact_type=type,
            description=description,
        )
        ticket_files = {f["path"]: f for f in ticket["files"]}
        for spec, content in zip(specs, blobs):
            url = ticket_files[spec["path"]]["url"]
            resp = requests.put(
                url,
                data=content,
                headers={"Content-Type": "application/octet-stream"},
                timeout=300.0,
            )
            resp.raise_for_status()
        return run._client.complete_artifact_upload(ticket["version"]["id"])
    except Exception as exc:  # noqa: BLE001 — never crash training
        warnings.warn(f"cursus: log_artifact() failed (dropped): {exc}")
        return None


def log_image(
    key: str,
    image: str | PathLike[str] | bytes | Any,
    step: int | None = None,
) -> dict[str, Any] | None:
    """Log one image at a step. Bytes go direct to object storage via a
    presigned URL (no boto — plain requests PUT); the server only signs.

    ``image`` is a file path, raw PNG/JPEG/WEBP bytes, a PIL Image, or a
    numpy array (last two need pillow installed). Never raises into user
    code: bad inputs, oversize files (>5 MB), and network failures warn
    and drop. Returns the completed media payload, or None when skipped.

    Example:
        cursus.log_image("val/samples", "pred_epoch3.png", step=3)
    """
    run = _get_current()
    if run is None:
        warnings.warn("cursus: log_image() called before init(); ignoring.")
        return None
    if step is None:
        warnings.warn("cursus: log_image() without step; using 0.")
        step = 0
    try:
        data, mime = encode_image(image)
    except (OSError, ValueError, TypeError) as exc:
        warnings.warn(f"cursus: log_image() skipping bad input: {exc}")
        return None
    if len(data) > _MAX_IMAGE_BYTES:
        warnings.warn(f"cursus: log_image() exceeds the 5 MB cap ({len(data)} bytes); skipping.")
        return None
    try:
        ticket = run._client.request_upload_url(run.id, key, int(step), mime, len(data))
        resp = requests.put(
            ticket["url"],
            data=data,
            headers={"Content-Type": mime},
            timeout=120.0,
        )
        resp.raise_for_status()
        return run._client.complete_upload(run.id, ticket["mediaId"])
    except Exception as exc:  # noqa: BLE001 — never crash training
        warnings.warn(f"cursus: log_image() failed (dropped): {exc}")
        return None


def _sweep_client(api_key: str | None, base_url: str | None) -> CursusClient:
    client = CursusClient(api_key=api_key, base_url=base_url)
    if not client.api_key:
        raise RuntimeError(
            "Missing Cursus API key. Set CURSUS_API_KEY, pass api_key=..., "
            "or write ~/.cursus/config."
        )
    client.check_version()
    return client


def create_sweep(
    project: str,
    space: dict[str, Any],
    name: str | None = None,
    method: str = "random",
    api_key: str | None = None,
    base_url: str | None = None,
) -> dict[str, Any]:
    """Create a sweep and return it (including ``id``).

    ``space`` maps names to ``{"values": [...]}`` (choice) or
    ``{"min": .., "max": .., "scale": "linear"|"log"}`` (random only).
    May raise like ``init()`` — sweeps are control calls, not logging.
    """
    client = _sweep_client(api_key, base_url)
    return client.create_sweep(
        project=project,
        name=name or f"sweep-{project}",
        method=method.upper(),
        space=space,
    )


def next_trial(
    sweep_id: str,
    api_key: str | None = None,
    base_url: str | None = None,
) -> dict[str, Any] | None:
    """Claim the next trial config, or None when the sweep is exhausted
    (grid done, or sweep finished/cancelled). May raise on transport
    errors — retry or abort the worker loop as you see fit.
    """
    client = _sweep_client(api_key, base_url)
    return client.next_trial(sweep_id)
