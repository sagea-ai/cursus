# `sagea-cursus` SDK — complete usage guide

The Python SDK logs training runs to a Cursus server. One process tracks
one run through a module-level singleton with wandb-shaped ergonomics:
`init` once, `log` in your loop, `finish` at the end. `requests` is the
only hard dependency (Python 3.9+). Numpy and pillow are lazy optional
extras, never install requirements.

```bash
pip install sagea-cursus
```

## Setup: key and server address

Every call authenticates with an API key. Create one at
`<server>/<org>/settings/keys` — shown once, copy it immediately. The
API Keys page also shows your deployment's base URL with a copy-paste
setup block.

| Precedence  | API key source                        | Base URL source                        |
| ----------- | ------------------------------------- | -------------------------------------- |
| 1 (highest) | `api_key=` argument                   | `base_url=` argument                   |
| 2           | `CURSUS_API_KEY` env var              | `CURSUS_BASE_URL` env var              |
| 3           | `~/.cursus/config` JSON `{"api_key"}` | `~/.cursus/config` JSON `{"base_url"}` |
| default     | — (raises)                            | `http://localhost:3000`                |

```bash
export CURSUS_API_KEY="cursus_..."
export CURSUS_BASE_URL="https://cursus.example.com"  # omit for localhost
```

```python
import sagea_cursus as cursus

# Environment credentials (preferred: nothing secret in code).
run = cursus.init(project="demo", config={"lr": 1e-4})

# Explicit credentials (handy for multi-server scripts — never commit
# real keys to git).
run = cursus.init(
    project="demo",
    config={"lr": 1e-4},
    api_key="cursus_...",
    base_url="https://cursus.example.com",
)
```

Without a key, `init()` raises `RuntimeError`. In CI prefer the env var;
on a shared training box the config file avoids secrets in shell
history. Trailing slashes on URLs are stripped. `init()` pings
`GET /api/v1/health` and raises on an incompatible server API version —
version skew fails fast at startup instead of confusingly mid-run.

## Complete example

```python
import sagea_cursus as cursus

run = cursus.init(
    project="demo",
    config={"lr": 1e-4, "arch": "mlp", "epochs": 100},
    name="baseline-a",
    tags=["v2-data"],
)
print("view at:", run.url)
try:
    for step in range(100):
        loss = 1.0 / (step + 1)
        cursus.log({"train/loss": loss}, step=step)
        if step % 10 == 0:
            cursus.log({"train/loss": loss, "eval/acc": step / 100}, step=step)
            cursus.log_image("val/samples", f"preds_{step:03d}.png", step=step)
        if step == 50:
            cursus.config.update({"lr": 1e-5})  # synced back, debounced
    cursus.log_artifact("mlp", "checkpoints/best.pt", type="model")
    cursus.finish()
except Exception:
    cursus.finish("crashed")
    raise
```

## `init()` — start a run

```python
run = cursus.init(
    project="demo",  # required: created on first use
    config={"lr": 1e-4},  # hyperparameter snapshot (see below)
    name="baseline-a",  # optional: server-generated when omitted
    tags=["v2-data"],  # optional: free-text labels (max 32)
    group="vision-team",  # optional: log inside a group project
    sweep_id="cmu…",  # optional: link into a running sweep
    api_key="cursus_…",  # optional: see Setup
    base_url="https://…",  # optional: see Setup
)
```

Returns a `Run` with `.id`, `.name`, `.url` (dashboard link), and
`.config` (a mutable dict mirror of the snapshot).

- `project` resolves or is created on first use. With `group="slug"`
  the project resolves inside that group — you must belong to it,
  otherwise the server rejects with 404 (indistinguishable from a
  missing project, by design). Without `group`, the project is
  org-wide and visible to every member.
- `sweep_id` links the run into a sweep (from `create_sweep` /
  `next_trial` below) — validated same-project and still running,
  otherwise creation fails.
- Calling `init()` twice warns and finishes the previous run first.
  One process tracks one run; log multi-process training from rank 0
  only.

## `log()` — record metrics

```python
cursus.log({"train/loss": 0.42}, step=epoch)
cursus.log({"train/loss": 0.42, "train/acc": 0.91}, step=epoch)
```

- Keys are free-form dotted paths (`"train/loss"`); values must be
  numeric (ints, floats — anything `float()` accepts).
- Always pass an explicit `step`. Omitting it warns and records step
  `0`, which collapses your whole curve onto one x-position.
- Points are queued and flushed in a background thread every **5
  seconds or every 50 points**, whichever comes first, as one bulk
  insert. `log()` never blocks training and **never raises**: network
  failures retry 3 times, then warn and drop the batch. A dead server
  costs you points, never a crashed training job.
- Calling `log()` before `init()` (or after `finish()`) warns and drops.

## `log_text()` — stdout/stderr lines

```python
cursus.log_text("epoch 1 loss 0.4", step=epoch)
cursus.log_text("NaN encountered, skipping batch", stream="stderr", step=epoch)
```

- Multi-line strings split into lines (blank lines skipped); lines
  truncate at 4000 chars server-side instead of rejecting.
- Batched like metrics (own background queue, 5 s / 50 lines) and
  flushed on `finish()` — same never-raises contract.
- View lines on the run's Logs tab: newest tail first, stdout/stderr
  filter, load-older pagination. Lines honor the 100k-per-run cap and
  the project's retention TTL like metrics.

## `finish()` — end the run

```python
cursus.finish()  # status="finished"
cursus.finish("crashed")  # or "killed"
```

- Flushes everything still buffered (metrics, pending config sync),
  stops the heartbeat, and marks the run `finished`, `crashed`, or
  `killed` — the only accepted statuses.
- Also never raises — safe in `finally` and `except` paths (see the
  complete example above).
- There is **no exit hook**: if the process dies without `finish()`,
  points still sitting in the buffer are lost and the run stays
  `RUNNING` until the server declares it stale (15 minutes without
  heartbeat/log) and flips it to `CRASHED` on the next read. Always
  finish in a `finally`.
- With no active run, `finish()` is a silent no-op.

## Config — snapshot plus mid-run sync

```python
run = cursus.init(project="demo", config={"lr": 1e-4, "opt": {"beta": 0.9}})

cursus.config["seed"] = 7  # same object as run.config
cursus.config.update({"lr": 1e-5})  # debounced server sync
```

- The `init` config is the frozen snapshot. `run.config` /
  `cursus.config` are the same mutable dict; `update()` syncs back
  debounced (one PATCH per 5 s burst) and `finish()` flushes, so the
  final config always lands.
- Server merge is deep (nested dicts recurse, arrays/scalars replace),
  last-write-wins, capped at 100 top-level keys / 32 KB — beyond that
  the sync warns and drops.
- Finished runs are immutable: updates after `finish()` stay local-only
  (the server answers 409, surfaced as a warning, never an exception).

## `log_artifact()` — attach files

```python
cursus.log_artifact(
    "yolov8m", "runs/train/weights/best.pt", type="model", description="map50: 0.61"
)
cursus.log_artifact("dataset", ["train.csv", "val.csv"], type="dataset")
```

- Each call creates a new **version** of the named artifact in the
  run's project (artifacts belong to projects, not runs). Accepts one
  path or a list; only file names (not directories) are stored; at most
  1000 files per call.
- `type` is a free string (`"model"`, `"dataset"`, …); `description`
  is shown on the version.
- Two-phase upload under the hood: the server mints presigned PUT
  tickets, bytes go direct to object storage (no boto, plain
  `requests`), then the version completes. No server body limits apply
  — up to **1 GB per file** (YOLO-scale checkpoints included) with a
  300 s per-file timeout.
- Same never-raises contract: missing/unreadable files are skipped
  with a warning, network failures warn and drop. Returns the completed
  version payload, or `None` when skipped.
- Call before `finish()` — versions record the producing run. Requires
  a server with object storage configured (otherwise a clear 503) and
  an SDK that speaks the ticket flow (0.2+).

## `log_image()` — log images

```python
cursus.log_image("val/samples", "pred_epoch3.png", step=3)  # file path
cursus.log_image("val/samples", open("a.png", "rb").read(), step=3)  # bytes

from PIL import Image

cursus.log_image("val/samples", Image.open("a.png"), step=3)  # PIL

import numpy as np  # needs pillow installed for encoding

cursus.log_image("val/samples", np.zeros((64, 64, 3), "uint8"), step=3)
```

- `image` is a file path, raw PNG/JPEG/WEBP bytes (sniffed by magic
  bytes — anything else warns and drops), a PIL Image, or a numpy
  array. The last two need pillow installed; it stays an optional,
  lazily-imported extra, never a hard dependency.
- Images upload **direct to object storage** over a short-lived
  presigned URL (plain `requests` PUT, no boto) — the server only
  signs. Caps: 5 MB per image, 500 images per run; re-logging a
  `(key, step)` overwrites the previous bytes.
- Same never-raises contract: bad inputs, oversize files, and network
  failures warn and drop. Returns the completed media payload, or
  `None` when skipped.
- View images on the run's Charts tab: one image at a time with a step
  scrubber, per key. URLs expire after 15 minutes — reload the page
  for fresh ones.

## Sweeps — grid/random search

```python
sweep = cursus.create_sweep(
    "demo",
    {"lr": {"min": 1e-5, "max": 1e-1, "scale": "log"}, "batch": {"values": [16, 32]}},
    name="lr-search",  # optional; method="random" is the default
)
while (trial := cursus.next_trial(sweep["id"])) is not None:
    run = cursus.init(
        project="demo",
        config=trial["config"],
        name=f"sweep-{trial['trial']}",
        sweep_id=trial["sweep_id"],
    )
    try:
        train(trial["config"])
        cursus.finish()
    except Exception:
        cursus.finish("crashed")
        raise
```

- `create_sweep(project, space, name=None, method="random")`: grid
  needs `{"values": [...]}` (2–50 entries) on every dim (≤10k
  combinations, ≤8 dims); random also takes
  `{"min": .., "max": .., "scale": "linear"|"log"}`. Like `init()`,
  creation may raise — sweeps are control calls, not logging.
- `next_trial(sweep_id)` claims the next config — transactionally for
  grid, so concurrent workers never share a cell — or returns `None`
  when the grid is exhausted or the sweep finished/cancelled: clean
  loop exit. Transport errors raise (retry or abort the worker loop
  as you see fit).
- Link runs with `init(..., sweep_id=...)` — validated same-project
  and still running. Trials appear on the sweep's page with configs.
  Launch one worker process per machine for parallel search.

## Groups, tags, and viewer keys

```python
# Group project (membership required) with names and tags.
run = cursus.init(
    project="detection", group="vision-team", name="baseline-a", tags=["v2-data"]
)
```

- API keys are per-user; create one per machine. Keys owned by
  **viewers** are read-scoped: they authenticate reads, but every
  write (`init`, `log`, `finish`, uploads, trials) answers 403.
- Deactivated users' keys are revoked automatically; deleted users'
  keys vanish with the account.

## Return values and `None` cases

| Call              | Success                                   | Skip/failure                                      |
| ----------------- | ----------------------------------------- | ------------------------------------------------- |
| `init()`          | `Run` (`.id`, `.name`, `.url`, `.config`) | raises                                            |
| `log()`           | `None`                                    | warns, drops                                      |
| `finish()`        | `None`                                    | warns (no active run: silent)                     |
| `config.update()` | `None` (debounced sync)                   | warns on sync failure                             |
| `log_artifact()`  | version payload dict                      | `None` + warning                                  |
| `log_image()`     | media payload dict                        | `None` + warning                                  |
| `create_sweep()`  | sweep dict (incl. `id`)                   | raises                                            |
| `next_trial()`    | `{"trial", "config", "sweep_id"}`         | `None` when exhausted; raises on transport errors |

## System metrics (automatic)

```python
run = cursus.init(project="demo")  # monitoring on by default
run = cursus.init(project="demo", monitor=False)  # opt out
```

```bash
CURSUS_MONITOR=0 python train.py  # env opt-out (also accepts "false"/"no")
```

- Every 10 s a daemon thread samples GPUs (`nvidia-smi` CSV parsing —
  never pynvml) and host (CPU via `/proc/stat`, memory via
  `/proc/meminfo`, disk via stdlib) and queues the points through the
  normal metric batcher. Zero new dependencies, zero server changes:
  system points are ordinary metrics under `system/`.
- Keys: `system/gpu.<i>.util`, `system/gpu.<i>.temp`,
  `system/gpu.<i>.power`, `system/gpu.<i>.mem_used_frac`,
  `system/cpu`, `system/mem_used_frac`, `system/disk_used_frac`.
  The run detail page auto-groups them into a System section, and
  workspace overlays pick them up like any key.
- Samples carry your last `log()` step, so GPU spikes align with
  training steps on shared axes.
- Machines without GPUs (or without `nvidia-smi`/`/proc`) warn once
  and disable the monitor — one warning per run, never one per
  sample. Sampler failures can never crash or block training.

## Heartbeats and stale runs

While a run is active the SDK heartbeats every 30 seconds on a daemon
thread, independent of training progress. If the process is killed (no
`finish`, no heartbeat, no logs for 15 minutes), the next dashboard/API
read lazily flips the run to `CRASHED`. Short pauses — GC, suspend,
slow eval — can never trip it (30 consecutive missed beats are
required).

## Error model

| Situation                                  | Behavior                                             |
| ------------------------------------------ | ---------------------------------------------------- |
| Missing API key at `init()`                | `RuntimeError` (the one loud failure)                |
| Server version incompatible                | `RuntimeError` at `init()`                           |
| Bad `create_sweep` space / dead sweep link | raises (`ValueError`/`RuntimeError` from the server) |
| Network/server error in `log()`            | warn after 3 retries, drop batch                     |
| Network/server error in `finish()`         | warn, never raise                                    |
| `log()` before `init()` / after `finish()` | warn, drop                                           |
| Bad/oversize image or artifact input       | warn, skip                                           |
| Config sync failure or frozen run          | warn, stay local                                     |
| `init()` twice                             | warn, finish previous run                            |

Design rule: `init()` and sweep control calls may raise; everything
else degrades to warnings. Training jobs must survive Cursus outages.

## Troubleshooting

- `RuntimeError: Missing Cursus API key` — no key in arg/env/config
  file. The API Keys page shows your deployment URL plus a copy-paste
  setup block.
- `RuntimeError: Incompatible Cursus server API version` — upgrade the
  SDK (`pip install -U sagea-cursus`) or the server; never mix majors.
- Flat line at step 0 in charts — a `log()` call missed `step=`.
- Run stuck `RUNNING` after a kill — expected until the 15-minute
  stale window passes; use `finish("crashed")` in a handler for
  instant accuracy.
- 404 on `init()` with `group=` — wrong slug, or you are not a member
  of that group (ask a super admin). The server never distinguishes
  the two.
- 403 on every write with a fresh key — the key belongs to a viewer
  account (read-scoped by design) or was revoked; check the API Keys
  page and `lastUsedAt`.
- `log_image` warns "unrecognized image format" — bytes are not
  PNG/JPEG/WEBP; "need pillow" — numpy arrays require it.
- `next_trial` keeps raising — the sweep was finished/cancelled (check
  the sweep page) or the worker's key lost write access.
- Missing tail points — the process exited without `finish()`;
  buffered points (up to 5 s / 50 points) were lost with the daemon
  thread.
