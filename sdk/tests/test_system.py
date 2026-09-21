"""Unit tests: system metrics collectors + monitor (no hardware)."""

from __future__ import annotations

import warnings

from sagea_cursus import _system as sys_mod


def test_parse_gpu_csv_multi_gpu_and_na() -> None:
    text = "0, 45 %, 61, 120.5, 4000, 8000\n1, N/A, 55, N/A, 2000, 8000\njunk line\n"
    gpus = sys_mod.parse_gpu_csv(text)
    assert len(gpus) == 2
    assert gpus[0] == {
        "util": 45.0,
        "temp": 61.0,
        "power": 120.5,
        "mem_used": 4000.0,
        "mem_total": 8000.0,
    }
    assert gpus[1] == {"temp": 55.0, "mem_used": 2000.0, "mem_total": 8000.0}


def test_collect_gpu_missing_binary_is_none() -> None:
    def boom(*a, **k):
        raise FileNotFoundError("no nvidia-smi")

    assert sys_mod.collect_gpu(runner=boom) is None


def test_parse_meminfo_fraction() -> None:
    text = "MemTotal:        8000000 kB\nMemAvailable:    2000000 kB\n"
    total_mb, frac = sys_mod.parse_meminfo(text)  # type: ignore[misc]
    assert total_mb == 8000000 / 1024.0
    assert abs(frac - 0.75) < 1e-9
    assert sys_mod.parse_meminfo("garbage") is None


def test_read_cpu_frac_from_snapshots() -> None:
    snaps = iter(
        [
            "cpu  100 0 100 800 0 0 0 0\n",
            "cpu  150 0 150 900 0 0 0 0\n",
        ]
    )
    frac = sys_mod.read_cpu_frac(read=lambda: next(snaps), sleep=lambda s: None)
    # busy delta 100 over total delta 200.
    assert frac is not None and abs(frac - 0.5) < 1e-9
    assert sys_mod.read_cpu_frac(read=lambda: "garbage", sleep=lambda s: None) is None


def test_sample_points_shapes_and_steps() -> None:
    points = sys_mod.sample_points(
        7,
        gpu_reader=lambda *a, **k: type(
            "P",
            (),
            {
                "stdout": "0, 10 %, 50, 100.0, 1000, 8000\n",
                "returncode": 0,
            },
        )(),
        host_reader=lambda p: "MemTotal: 8000000 kB\nMemAvailable: 4000000 kB\n",
    )
    by_key = {p["key"]: p for p in points}
    assert by_key["system/gpu.0.util"]["value"] == 10.0
    assert by_key["system/gpu.0.mem_used_frac"]["value"] == 0.125
    assert by_key["system/mem_used_frac"]["value"] == 0.5
    assert all(p["step"] == 7 and "wall_time" in p for p in points)


def test_monitor_warns_once_then_sends() -> None:
    sent = []
    mon = sys_mod.SystemMonitor(send=sent.append, get_step=lambda: 3)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        mon.sample_once()  # real hardware likely absent in CI
    if not sent:
        assert any("system" in str(w.message).lower() for w in caught)
        assert mon._stop.is_set()
    else:
        assert all(p["step"] == 3 for p in sent[0])
    mon.stop()


def test_monitor_opt_out() -> None:
    from types import SimpleNamespace

    from sagea_cursus import _run as run_mod

    assert (
        run_mod.Run(client=SimpleNamespace(), run_id="r", name="n", url="u", monitor=False)._monitor
        is None
    )
