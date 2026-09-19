"""Sweep worker: pull trials until the sweep is exhausted.

Creates a small random sweep, then runs trials one by one. Launch one
worker per machine — grid claims are transactional, so workers never
share a cell. Needs a live server + key (see basic_loop.py).
"""

from __future__ import annotations

import os
import sys
from typing import Any

import sagea_cursus as cursus


def train(config: dict[str, Any]) -> float:
    score = 1.0 / (1.0 + float(config.get("lr", 0.01)))
    cursus.log({"score": score}, step=0)
    return score


def main() -> None:
    if not os.environ.get("CURSUS_API_KEY"):
        sys.exit("set CURSUS_API_KEY first (see README)")
    sweep = cursus.create_sweep(
        "demo",
        {
            "lr": {"min": 1e-5, "max": 1e-1, "scale": "log"},
            "batch": {"values": [16, 32]},
        },
        name="readme-search",
    )
    print("sweep:", sweep["id"])
    while (trial := cursus.next_trial(sweep["id"])) is not None:
        run = cursus.init(
            project="demo",
            config=trial["config"],
            name=f"sweep-{trial['trial']}",
            sweep_id=trial["sweep_id"],
        )
        print("trial", trial["trial"], trial["config"], "->", run.url)
        try:
            train(trial["config"])
            cursus.finish()
        except Exception:
            cursus.finish("crashed")
            raise


if __name__ == "__main__":
    main()
