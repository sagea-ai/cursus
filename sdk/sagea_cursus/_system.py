"""Automatic system metrics (GPU + host) — stdlib only, no new dependencies.

GPUs via ``nvidia-smi`` CSV parsing (never pynvml); host via ``/proc``
with graceful degradation off-Linux. All collectors are pure functions
of injected readers, so unit tests never touch hardware. Failures warn
once, then go silent until the next successful sample.
"""

from __future__ import annotations

import shutil
import subprocess
import threading
import time
import warnings
from datetime import datetime, timezone
from typing import Any, Callable

SYSTEM_SAMPLE_INTERVAL_S = 10.0


import math


def _utcnow_z() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _read_proc_stat() -> str:
    with open("/proc/stat", encoding="utf-8") as f:
        return f.read()


def _read_proc_file(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def _parse_float(raw: str) -> float | None:
    try:
        value = float(raw.strip().rstrip("%"))
    except (TypeError, ValueError):
        return None
    if math.isnan(value) or math.isinf(value):
        return None
    return value


def parse_gpu_csv(text: str) -> list[dict[str, float]]:
    """Parse nvidia-smi CSV rows into per-GPU field dicts (skips N/A)."""
    gpus: list[dict[str, float]] = []
    for line in text.splitlines():
        cells = [c.strip() for c in line.split(",")]
        if len(cells) < 6:
            continue
        index = _parse_float(cells[0])
        if index is None:
            continue
        gpu: dict[str, float] = {}
        for field, raw in (
            ("util", cells[1]),
            ("temp", cells[2]),
            ("power", cells[3]),
            ("mem_used", cells[4]),
            ("mem_total", cells[5]),
        ):
            value = _parse_float(raw)
            if value is not None:
                gpu[field] = value
        gpus.append(gpu)
    return gpus


def collect_gpu(
    runner: Callable[..., Any] | None = None,
) -> list[dict[str, float]] | None:
    """Query GPUs; None when nvidia-smi is missing/failing (not an error —
    most machines have no GPU, and the monitor latches off after warning)."""
    run = runner or subprocess.run
    try:
        proc = run(
            [
                "nvidia-smi",
                "--query-gpu=index,utilization.gpu,temperature.gpu,power.draw,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    gpus = parse_gpu_csv(proc.stdout)
    return gpus or None


def parse_meminfo(text: str) -> tuple[float, float] | None:
    """(total_mb, used_frac) from /proc/meminfo text."""
    total = avail = None
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        if parts[0] == "MemTotal:":
            total = _parse_float(parts[1])
        elif parts[0] == "MemAvailable:":
            avail = _parse_float(parts[1])
    if not total:
        return None
    used = total - (avail if avail is not None else 0.0)
    return total / 1024.0, used / total


def read_cpu_frac(
    read: Callable[[], str] | None = None,
    sleep: Callable[[float], None] | None = None,
) -> float | None:
    """CPU busy fraction from two /proc/stat snapshots (~0.1 s apart)."""
    rd = read or _read_proc_stat
    sl = sleep or time.sleep
    try:
        first = rd().splitlines()[0].split()[1:]
        sl(0.1)
        second = rd().splitlines()[0].split()[1:]
        a = [float(x) for x in first[:8]]
        b = [float(x) for x in second[:8]]
        busy_a = sum(a) - a[3] - a[4]
        busy_b = sum(b) - b[3] - b[4]
        total = sum(b) - sum(a)
        if total <= 0:
            return None
        return max(0.0, min(1.0, (busy_b - busy_a) / total))
    except (OSError, IndexError, ValueError):
        return None


def collect_host(
    read_text: Callable[[str], str] | None = None,
) -> dict[str, float]:
    """Best-effort host stats; missing sources are simply absent."""
    rd = read_text or _read_proc_file
    out: dict[str, float] = {}
    try:
        mem = parse_meminfo(rd("/proc/meminfo"))
    except OSError:
        mem = None
    if mem is not None:
        out["mem_used_frac"] = mem[1]
    cpu = read_cpu_frac()
    if cpu is not None:
        out["cpu"] = cpu
    try:
        usage = shutil.disk_usage("/")
        out["disk_used_frac"] = 1.0 - usage.free / usage.total if usage.total else 0.0
    except OSError:
        pass
    return out


def sample_points(
    step: int,
    gpu_reader: Callable[..., Any] | None = None,
    host_reader: Callable[[str], str] | None = None,
) -> list[dict[str, Any]]:
    """One sample across GPUs + host, shaped like metric-batch points."""
    wall = _utcnow_z()
    points: list[dict[str, Any]] = []
    gpus = collect_gpu(runner=gpu_reader)
    if gpus:
        for i, gpu in enumerate(gpus):
            if "util" in gpu:
                points.append(
                    {
                        "key": f"system/gpu.{i}.util",
                        "step": step,
                        "value": gpu["util"],
                        "wall_time": wall,
                    }
                )
            if "temp" in gpu:
                points.append(
                    {
                        "key": f"system/gpu.{i}.temp",
                        "step": step,
                        "value": gpu["temp"],
                        "wall_time": wall,
                    }
                )
            if "power" in gpu:
                points.append(
                    {
                        "key": f"system/gpu.{i}.power",
                        "step": step,
                        "value": gpu["power"],
                        "wall_time": wall,
                    }
                )
            if "mem_used" in gpu and "mem_total" in gpu and gpu["mem_total"]:
                points.append(
                    {
                        "key": f"system/gpu.{i}.mem_used_frac",
                        "step": step,
                        "value": gpu["mem_used"] / gpu["mem_total"],
                        "wall_time": wall,
                    }
                )
    for key, value in collect_host(read_text=host_reader).items():
        points.append({"key": f"system/{key}", "step": step, "value": value, "wall_time": wall})
    return points


class SystemMonitor:
    """Daemon sampler: collect → send every interval. Warns once on
    failure, then silent until the next success (a GPU-less box logs
    exactly one warning per run, not one per 10 s)."""

    def __init__(
        self,
        send: Callable[[list[dict[str, Any]]], None],
        get_step: Callable[[], int],
        interval: float = SYSTEM_SAMPLE_INTERVAL_S,
    ) -> None:
        self._send = send
        self._get_step = get_step
        self._interval = interval
        self._stop = threading.Event()
        self._warned = False
        self._thread = threading.Thread(target=self._loop, name="cursus-sys", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self, timeout: float = 2.0) -> None:
        self._stop.set()
        if self._thread.is_alive():
            self._thread.join(timeout=timeout)

    def sample_once(self) -> None:
        try:
            points = sample_points(self._get_step())
        except Exception as exc:  # noqa: BLE001 — sampler never propagates
            if not self._warned:
                self._warned = True
                warnings.warn(f"cursus: system sampling failed ({exc}); disabling.")
                self._stop.set()
            return
        if not points:
            if not self._warned:
                self._warned = True
                warnings.warn("cursus: no system metrics available; disabling monitor.")
                self._stop.set()
            return
        self._warned = False
        try:
            self._send(points)
        except Exception as exc:  # noqa: BLE001 — never block training
            warnings.warn(f"cursus: system sample dropped: {exc}")

    def _loop(self) -> None:
        while not self._stop.wait(self._interval):
            self.sample_once()
