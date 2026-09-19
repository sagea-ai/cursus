"""Images, artifacts, and mid-run config updates.

Needs a live server + key (see basic_loop.py) and pillow for the numpy
branch — paths/bytes work without it.
"""

from __future__ import annotations

import os
import sys

import sagea_cursus as cursus


def main() -> None:
    if not os.environ.get("CURSUS_API_KEY"):
        sys.exit("set CURSUS_API_KEY first (see README)")
    run = cursus.init(project="vision", config={"backbone": "resnet50"})
    print("view at:", run.url)
    try:
        for epoch in range(3):
            cursus.log({"train/loss": 0.4 / (epoch + 1)}, step=epoch)
            # Any of: file path, PNG/JPEG/WEBP bytes, PIL Image, numpy array.
            try:
                import numpy as np

                pixels = np.zeros((16, 16, 3), dtype="uint8")
                pixels[:, :, 0] = epoch * 80
                cursus.log_image("val/samples", pixels, step=epoch)
            except ImportError:
                print("numpy/pillow missing — skipping image demo")
            if epoch == 1:
                cursus.config.update({"lr": 1e-5})  # debounced sync
        # Attach a checkpoint file (skipped with a warning when missing).
        cursus.log_artifact("demo-model", "best.pt", type="model", description="demo")
        cursus.finish()
    except Exception:
        cursus.finish("crashed")
        raise


if __name__ == "__main__":
    main()
