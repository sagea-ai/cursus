"""Basic training loop: scalars + crash-safe finish.

Needs a live server + key:
    export CURSUS_API_KEY="cursus_..."
    export CURSUS_BASE_URL="http://localhost:3000"  # optional
    python examples/basic_loop.py
"""

from __future__ import annotations

import os
import sys

import sagea_cursus as cursus


def main() -> None:
    if not os.environ.get("CURSUS_API_KEY"):
        sys.exit("set CURSUS_API_KEY first (see README)")
    run = cursus.init(project="demo", config={"lr": 1e-4, "arch": "mlp"})
    print("view at:", run.url)
    try:
        for step in range(100):
            loss = 1.0 / (step + 1)
            cursus.log({"train/loss": loss}, step=step)
            if step % 10 == 0:
                cursus.log({"train/loss": loss, "eval/acc": step / 100}, step=step)
        cursus.finish()
    except Exception:
        cursus.finish("crashed")
        raise


if __name__ == "__main__":
    main()
