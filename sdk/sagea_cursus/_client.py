"""HTTP client — the ONLY place that builds requests or reads key/URL config.

Every public function funnels through this one client;
no ad hoc ``requests.post(...)`` calls elsewhere.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import requests

#: Server API version this SDK understands. Checked loudly on init:
#: a mismatch raises instead of failing confusingly mid-run.
MIN_SERVER_API_VERSION = 1
DEFAULT_BASE_URL = "http://localhost:3000"


def _read_config_file() -> dict[str, str]:
    path = Path.home() / ".cursus" / "config"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def resolve_api_key(explicit: str | None = None) -> str | None:
    """Precedence: explicit arg > CURSUS_API_KEY env > ~/.cursus/config."""
    if explicit:
        return explicit
    env = os.environ.get("CURSUS_API_KEY")
    if env:
        return env
    cfg = _read_config_file()
    key = cfg.get("api_key")
    return str(key) if key else None


def resolve_base_url(explicit: str | None = None) -> str:
    """Precedence: explicit arg > CURSUS_BASE_URL env > config file > default."""
    if explicit:
        return explicit.rstrip("/")
    env = os.environ.get("CURSUS_BASE_URL")
    if env:
        return env.rstrip("/")
    cfg = _read_config_file()
    url = cfg.get("base_url")
    if url:
        return str(url).rstrip("/")
    return DEFAULT_BASE_URL


class CursusClient:
    """Thin wrapper over requests.Session with base URL + bearer auth."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 10.0,
    ) -> None:
        self.api_key = resolve_api_key(api_key)
        self.base_url = resolve_base_url(base_url)
        self.timeout = timeout
        self._session = requests.Session()
        if self.api_key:
            self._session.headers.update({"Authorization": f"Bearer {self.api_key}"})

    def check_version(self) -> None:
        """Fail loudly on incompatible server."""
        resp = self._session.get(f"{self.base_url}/api/v1/health", timeout=self.timeout)
        resp.raise_for_status()
        try:
            version = int(resp.json().get("api_version", 0))
        except (ValueError, AttributeError):
            version = 0
        if version < MIN_SERVER_API_VERSION:
            raise RuntimeError(
                f"Incompatible Cursus server API version {version}; "
                f"this SDK requires >= {MIN_SERVER_API_VERSION}. "
                "Upgrade the SDK or the server."
            )

    def create_run(
        self,
        project: str,
        name: str | None = None,
        config: dict[str, Any] | None = None,
        tags: list[str] | None = None,
        group: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "project": project,
            "name": name,
            "config": config or {},
            "tags": tags or [],
        }
        if group:
            body["group"] = group
        resp = self._session.post(
            f"{self.base_url}/api/v1/runs",
            json=body,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    def log_batch(self, run_id: str, points: list[dict[str, Any]]) -> None:
        resp = self._session.post(
            f"{self.base_url}/api/v1/runs/{run_id}/log",
            json={"points": points},
            timeout=self.timeout,
        )
        resp.raise_for_status()

    def finish_run(self, run_id: str, status: str = "finished") -> None:
        resp = self._session.post(
            f"{self.base_url}/api/v1/runs/{run_id}/finish",
            json={"status": status},
            timeout=self.timeout,
        )
        resp.raise_for_status()

    def heartbeat(self, run_id: str) -> None:
        resp = self._session.patch(
            f"{self.base_url}/api/v1/runs/{run_id}/heartbeat",
            timeout=self.timeout,
        )
        resp.raise_for_status()

    def request_upload_url(
        self,
        run_id: str,
        key: str,
        step: int,
        mime: str,
        size: int,
    ) -> dict[str, Any]:
        resp = self._session.post(
            f"{self.base_url}/api/v1/runs/{run_id}/media/upload-url",
            json={"key": key, "step": step, "mime": mime, "sizeBytes": size},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    def complete_upload(self, run_id: str, media_id: str) -> dict[str, Any]:
        resp = self._session.post(
            f"{self.base_url}/api/v1/runs/{run_id}/media/{media_id}/complete",
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    def create_artifact_version(
        self,
        name: str,
        files: list[tuple[str, bytes]],
        run_id: str | None = None,
        artifact_type: str = "model",
        description: str = "",
    ) -> dict[str, Any]:
        """Upload one version of an artifact (multipart, requests only)."""
        data = {
            "name": name,
            "type": artifact_type,
            "description": description,
        }
        if run_id:
            data["run_id"] = run_id
        multipart = [
            ("files", (path, content, "application/octet-stream")) for path, content in files
        ]
        resp = self._session.post(
            f"{self.base_url}/api/v1/artifacts",
            data=data,
            files=multipart,
            timeout=max(self.timeout, 120.0),
        )
        resp.raise_for_status()
        return resp.json()
