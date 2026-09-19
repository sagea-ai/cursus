# `sagea-cursus` SDK usage

The Python SDK logs training runs to a Cursus server. One process tracks one
run through a module-level singleton with wandb-shaped ergonomics: `init`
once, `log` in your loop, `finish` at the end. `requests` is the only hard
dependency (Python 3.9+).

```bash
pip install sagea-cursus
```

```python
import sagea_cursus as cursus

run = cursus.init(project="demo", config={"lr": 1e-4})
for step in range(100):
    cursus.log({"train/loss": 1.0 / (step + 1)}, step=step)
cursus.finish()
```

## Authentication

Every call authenticates with an API key. Create one at
`<server>/<org>/settings/keys` (shown once — copy it immediately) and supply
it the first way that exists:

| Precedence  | Source                                   |
| ----------- | ---------------------------------------- |
| 1 (highest) | `api_key=` argument to `init()`          |
| 2           | `CURSUS_API_KEY` environment variable    |
| 3           | `~/.cursus/config` JSON `{"api_key": …}` |

Without a key, `init()` raises `RuntimeError`. In CI, prefer the env var;
on a shared training box, the config file avoids secrets in shell history.

## Server address

Default is `http://localhost:3000`. Override per call or environment:

| Precedence  | Source                                    |
| ----------- | ----------------------------------------- |
| 1 (highest) | `base_url=` argument to `init()`          |
| 2           | `CURSUS_BASE_URL` environment variable    |
| 3           | `~/.cursus/config` JSON `{"base_url": …}` |

Trailing slashes are stripped. `init()` pings `GET /api/v1/health` and
raises on an incompatible server API version — a version skew fails fast at
startup instead of confusingly mid-run.

## `init()` — start a run

```python
run = cursus.init(
    project="demo",  # required: created on first use
    config={"lr": 1e-4},  # frozen hyperparameter snapshot
    name="baseline-a",  # optional: server-generated when omitted
    tags=["v2-data"],  # optional: free-text labels
    group="vision-team",  # optional: log inside a group project
    api_key="cursus_…",  # optional: see Authentication
    base_url="https://…",  # optional: see Server address
)
```

- Returns a `Run` with `.id`, `.name`, `.url`, and `.config`.
- `project` resolves or is created on first use. With `group="slug"` the
  project resolves inside that group — you must belong to it, otherwise the
  server rejects with 404 (indistinguishable from a missing project, by
  design). Without `group`, the project is org-wide and visible to every
  member.
- `config` is snapshotted at `init` time. `run.config` / `cursus.config`
  stay mutable, and mid-run `update()` calls sync back debounced (one PATCH
  per 5 s burst, flushed on `finish()` so the final config always lands).
  Finished runs are immutable — updates after `finish()` stay local-only.
- Calling `init()` twice warns and finishes the previous run first. One
  process tracks one run; log multi-process training from rank 0 only.

## `log()` — record metrics

```python
cursus.log({"train/loss": 0.42, "train/acc": 0.91}, step=epoch)
```

- Keys are free-form dotted paths (`"train/loss"`); values must be numeric.
- Always pass an explicit `step`. Omitting it warns and records step `0`,
  which collapses your whole curve onto one x-position.
- Points are queued and flushed in a background thread every **5 seconds or
  every 50 points**, whichever comes first, as one bulk insert. `log()`
  never blocks training and **never raises**: network failures retry 3
  times, then warn and drop the batch. A dead server costs you points, never
  a crashed training job.
- Calling `log()` before `init()` (or after `finish()`) warns and drops.

## `finish()` — end the run

```python
cursus.finish()  # status="finished"
cursus.finish("crashed")  # or "killed"
```

- Flushes everything still buffered, stops the heartbeat, and marks the run
  `finished`, `crashed`, or `killed` (the only accepted statuses).
- Also never raises — safe in `finally` and `except` paths:

```python
run = cursus.init(project="demo")
try:
    train()
    cursus.finish()
except Exception:
    cursus.finish("crashed")
    raise
```

- There is **no exit hook**: if the process dies without `finish()`, points
  still sitting in the buffer are lost and the run stays `RUNNING` until the
  server declares it stale (15 minutes without heartbeat/log) and flips it
  to `CRASHED` on the next read. Always finish in a `finally`.
- With no active run, `finish()` is a silent no-op.

## `log_artifact()` — attach files

```python
cursus.log_artifact(
    "yolov8m", "runs/train/weights/best.pt", type="model", description="map50: 0.61"
)
cursus.log_artifact("dataset", ["train.csv", "val.csv"], type="dataset")
```

- Each call creates a new **version** of the named artifact in the run's
  project (artifacts belong to projects, not runs). Accepts one path or a
  list; only the file names (not directories) are stored.
- `type` is a free string (`"model"`, `"dataset"`, …); `description` is
  shown on the version.
- Same never-raises contract: missing/unreadable files are skipped with a
  warning, network failures warn and drop. Returns the created version
  payload, or `None` when skipped. Uploads allow up to ~100 MB per file and
  use a longer (120 s) timeout.
- Call before `finish()` — versions record the producing run.

## `log_image()` — log images

```python
cursus.log_image("val/samples", "pred_epoch3.png", step=3)
```

- `image` is a file path, raw PNG/JPEG/WEBP bytes, a PIL Image, or a numpy
  array (the last two need pillow installed — it stays an optional,
  lazily-imported extra, never a hard dependency).
- Images upload **direct to object storage** over a short-lived presigned
  URL (plain `requests` PUT, no boto) — the server only signs. Caps: 5 MB
  per image, 500 images per run; re-logging a `(key, step)` overwrites.
- Same never-raises contract: bad inputs, oversize files, and network
  failures warn and drop. Returns the completed media payload, or `None`.
- View images on the run's Charts tab: one image at a time with a step
  scrubber, per key.

## Sweeps — grid/random search

```python
sweep = cursus.create_sweep(
    "demo",
    {"lr": {"min": 1e-5, "max": 1e-1, "scale": "log"}, "batch": {"values": [16, 32]}},
)
while (trial := cursus.next_trial(sweep["id"])) is not None:
    run = cursus.init(
        project="demo",
        config=trial["config"],
        name=f"sweep-{trial['trial']}",
        sweep_id=trial["sweep_id"],
    )
    train(trial["config"])
    cursus.finish()
```

- `create_sweep(project, space, name=None, method="random")`: grid needs
  `{"values": [...]}` on every dim (≤10k combinations); random also takes
  `{"min": .., "max": .., "scale": "linear"|"log"}`. May raise like `init()`.
- `next_trial(sweep_id)` claims the next config (transactionally for
  grid — concurrent workers never share a cell) or returns `None` when
  the grid is exhausted or the sweep finished/cancelled: clean loop exit.
- Link runs with `init(..., sweep_id=...)` — validated same-project and
  still running. Trials appear on the sweep's page with their configs.

## Heartbeats and stale runs

While a run is active the SDK heartbeats every 30 seconds on a daemon
thread, independent of training progress. If the process is killed (no
`finish`, no heartbeat, no logs for 15 minutes), the next dashboard/API
read lazily flips the run to `CRASHED`. Short pauses — GC, suspend, slow
eval — can never trip it (30 consecutive missed beats are required).

## Error model

| Situation                                  | Behavior                              |
| ------------------------------------------ | ------------------------------------- |
| Missing API key at `init()`                | `RuntimeError` (the one loud failure) |
| Server version incompatible                | `RuntimeError` at `init()`            |
| Network/server error in `log()`            | warn after 3 retries, drop batch      |
| Network/server error in `finish()`         | warn, never raise                     |
| `log()` before `init()` / after `finish()` | warn, drop                            |
| `init()` twice                             | warn, finish previous run             |

Design rule: `init()` may raise; everything else degrades to warnings.
Training jobs must survive Cursus outages.

## Troubleshooting

- `RuntimeError: Missing Cursus API key` — no key in arg/env/config file.
- `RuntimeError: Incompatible Cursus server API version` — upgrade the SDK
  (`pip install -U sagea-cursus`) or the server; never mix majors.
- Flat line at step 0 in charts — a `log()` call missed `step=`.
- Run stuck `RUNNING` after a kill — expected until the 15-minute stale
  window passes; use `finish("crashed")` in a handler for instant accuracy.
- 404 on `init()` with `group=` — wrong slug, or you are not a member of
  that group (ask a super admin). The server never distinguishes the two.
- Missing tail points — the process exited without `finish()`; buffered
  points (up to 5 s / 50 points) were lost with the daemon thread.
