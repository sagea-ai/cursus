# PRD: Cursus remaining-parity roadmap

- Writer: RUNE
- Status: accepted, implementation starts at M15
- Scope: every W&B gap still open after v0.4.0 (media, sweeps-minimal,
  webhooks, viewer, bulk ops, SSO, retention, config sync, export,
  workspace overlays, run logs are all shipped — see CHANGELOG).

> Location note: planning artifact at repo root on purpose. `docs/`
> holds product documentation only (`npm run lint:docs` enforces it).

## 0. Objective

Close the daily-felt gaps against Weights & Biases in build order,
without breaking the house rules: Postgres-only metadata, bounded
queries, visibility filters that extend but never fork, one auth guard,
tests per feature, and an SDK that never crashes training and gains no
hard dependencies (`requests` stays the only one; numpy/pillow/pynvml
stay lazy optionals — and this PRD adds none, see M15).

## 1. Ground rules (every milestone)

- **G1 — Visibility extends, never forks.** New reads go through the
  existing filter helpers or they don't ship.
- **G2 — Auth through `requireRole()` only**, both-role tests for gated
  routes, hierarchical roles respected (viewers read, never write).
- **G3 — Bounded queries with stated budgets.** No N+1, no unbounded
  `include`, caps named in code.
- **G4 — SDK never raises except `init()`/control calls**, warns +
  drops otherwise, mocked-transport tests, no new hard dependencies.
- **G5 — Reversible-first lifecycle**, statuses from sentinels, content
  reassigned never destroyed (established pattern, keep it).

## 2. Build order

```
M15 system metrics ──► M16 SDK read API ──► M17 tables ──► M18 media breadth
  (first: biggest daily gap, zero deps)
M19 chart depth ──► M20 sweep depth (on demand only) ──► M21 artifact depth
M22 files tab ──► M23 offline mode ──► M24 metric control ──► M25 automations
M26 runs-table depth + comments
```

Still out (unchanged): Launch/job orchestration, report builder,
Weave-style tracing/evals, billing/metering, SCIM, mobile app,
multi-org-per-user.

---

## M15 — System metrics auto-capture (first, size M)

W&B's most visible daily surface: `system/*` panels with zero user code.
Cursus has nothing automatic today.

### Behavior

- On by default for every run; `cursus.init(..., monitor=False)` or
  `CURSUS_MONITOR=0` disables. No-GPU and no-permission environments
  warn once and cost nothing afterwards.
- Sampler thread (daemon, every 10 s): NVIDIA GPUs via `nvidia-smi`
  CSV parsing (subprocess, stdlib only — never pynvml), host via
  `/proc` (`/proc/stat` deltas for CPU %, `/proc/meminfo` for mem %,
  `shutil.disk_usage` for disk %). Non-Linux degrades gracefully
  (disk always; CPU/mem best-effort; GPUs via `nvidia-smi` wherever it
  exists).
- Keys (all under `system/`, so run detail auto-groups a System
  section and workspace overlays just work):
  `system/gpu.<i>.util`, `system/gpu.<i>.temp`,
  `system/gpu.<i>.power`, `system/gpu.<i>.mem_used_frac`,
  `system/cpu`, `system/mem_used_frac`, `system/disk_used_frac`.
- Step stamping: samples carry the run's last user `log()` step
  (tracked on the Run object, default 0), so GPU spikes align with
  training steps on shared x-axes — strictly better than a private
  sample counter.
- Points flow through the existing metric batcher (same 5 s / 50 flush,
  retries, warn+drop). Sampler failures never propagate: one warning,
  then silent until the next successful sample.

### API / schema

None. Zero server changes — system points are ordinary metric points
through `log_batch`. Caps, retention, export, and downsampling apply
unchanged.

### SDK

- New private module `_system.py`: pure collectors
  (`collect_gpu()`, `collect_host()` — injectable readers for tests),
  `SystemMonitor` thread (start/stop, callback, single-shot warn
  latch). Unit-testable without hardware.
- `Run` starts the monitor on `init` (unless disabled), stops +
  flushes on `finish()`.
- `cursus.init(..., monitor: bool = True)`.

### Tests & acceptance

- Unit (mocked readers): GPU CSV parse incl. multi-GPU + missing
  binary, `/proc` parse, step stamping, opt-out flag/env, failure
  warn-once, thread stops on finish.
- No E2E (CI has no GPU); API-level coverage inherits from metrics.
- Accept: on a GPU box, a 1-epoch run shows `system/gpu.0.*` charts
  grouped under System; on a CPU-only box exactly one warning and no
  recurring overhead (subprocess only fires per sample while enabled).

## M16 — SDK read API (size M)

The SDK is write-only today; everything programmatic unlocks from reads.

- `cursus.runs(project, limit=...) -> list[dict]` (id, name, status,
  config, summary, url) — visibility-scoped to the key owner.
- `cursus.metrics(run_id, key, max_points=2000) -> list[{step, value}]`.
- `cursus.download_artifact(name, dest, project=None, version="latest")`
  (server already presigns; SDK follows redirects).
- Read Palm: transport errors **raise** here (reads are control calls
  like `init()`, not training-loop logging) — documented split.
- Tests: mocked transport for all three; integration opt-in suite
  extended. Docs: `docs/sdk.md` read section.

## M17 — Logged tables (size M)

`wandb.Table` equivalent: queryable row data attached to runs.

- `cursus.log_table(key, columns, rows, step=None)`: columns
  (name/type), rows as lists (JSON-serializable scalars only, validated
  client-side); stored as one artifact version of `type="table"` with a
  `table.json` payload (cap 5 MB, 10k rows) — reuses the artifact
  pipeline (presigned flow, versions, project scoping) instead of a new
  table.
- Viewer: run detail table renderer (paginated client-side, 100
  rows/page, column sort) on the Charts tab next to media.
- Server: no new tables; one new `GET` returning the parsed payload
  with the artifact visibility gate. Tests: caps, validation, viewer,
  E2E list assertion.

## M18 — Media breadth: audio + video (size M)

Same two-phase presigned pattern as images (M6), extended MIME
allowlist (`audio/wav`, `audio/mpeg`, `video/mp4`, `video/webm`),
15 MB per item (images stay 5 MB).

- `cursus.log_audio(key, path/bytes/array, step, sample_rate=...)` —
  numpy arrays encoded to WAV via stdlib `wave` (no scipy); sample
  rate stored alongside, capped at 10 min duration equivalent.
- `cursus.log_video(key, path/bytes, step)` — container bytes only,
  no re-encoding (ffmpeg is never a dependency).
- Viewer: native `<audio>` / `<video>` elements with the step slider;
  completion/HEAD/orange-path identical to images.
- Tests mirror the image suite (mocked storage, caps, E2E with tiny
  fixtures committed to the repo).

## M19 — Chart depth (size S–M, splittable)

- Smoothing toggle (exponential moving average, client-side, per
  chart, default off) + log-scale y-axis toggle. Pure render options —
  no API change.
- Custom x-axis: plot any numeric metric key as x (default step).
  Overlay endpoint gains `x_key` (second indexed range scan per run,
  same budget class).
- Saved workspace views: named `{runs, keys, sections}` JSON per
  project (new `WorkspaceView` table, CRUD routes, member-write
  gated), picker on the workspace page. Per-user or shared? Shared
  per project (simpler, matches team workflows).
- Tests per slice; each ships independently.

## M20 — Sweep depth (size L, on demand only)

Only if grid/random prove insufficient:

- Bayesian search (Gaussian-process surrogate, server-side, new
  `BAYESIAN` method; suggest endpoint replaces random sampling for
  that method; still worker-pull, still no launcher).
- Early termination (median-stopping rule evaluated at trial log
  time; `stopped` trial state surfaced in the trials table).
- Parallel-coordinates console on the sweep page (client-rendered
  from trial configs + a chosen metric's summary — bounded to 200
  trials).
- Each slice shippable alone; Bayesian never blocks the other two.

## M21 — Artifact depth (size M–L, splittable)

- Aliases (`latest`, `best`, custom mutable tags; move-alias route,
  resolved at download; unique per artifact).
- Lineage: `used_by` edges (run → artifact version at log time,
  artifact → run at download-training time via `use_artifact()`);
  DAG renderer on the artifact page (bounded 100 edges).
- Registry linking: promote a version to a named registry entry
  (new `RegistryEntry` model, org-scoped, admin-curated).
- Type previews: image thumbnails, CSV head preview, text preview
  (served from presigned bytes, truncated server-side for text).
- Aliases first (smallest, highest value); lineage second; registry
  last.

## M22 — Files tab (size S)

W&B run Files equivalent, cheap because the pieces exist:

- SDK captures `requirements.txt`-equivalent (installed dists via
  `importlib.metadata`, top 100) + `git diff` (best-effort, skipped
  outside repos) as run-attached files on `init()` (once, tiny).
- `output.log` auto-capture: opt-in `cursus.init(..., capture_output=True)`
  tee-ing stdout/stderr into `log_text` batches (default off —
  explicit beats magic; pairs with the Logs tab).
- Files tab on run detail lists code snapshot + diff + output log
  (metadata from a new `run_files` summary key, bytes via the artifact
  pipeline or inline for <100 KB).

## M23 — Offline mode (size M)

Dead server currently means dropped points. Opt-in durability:

- `cursus.init(..., offline=True)` or `CURSUS_OFFLINE=1`: batches
  append to a local SQLite queue (`~/.cursus/queue/<run>.db`, WAL
  mode) instead of POSTing; `finish()` seals the queue.
- `cursus sync <queue-file>` CLI (new `__main__.py`): replays in
  order (metrics, logs, config, media/artifact tickets), then marks
  synced. Server needs zero changes (replay uses existing endpoints;
  idempotency via existing upsert semantics where they exist).
- Caps: 1 GB queue default, clear error beyond. Tests: replay order,
  crash mid-queue resume, corrupt-row skip. Docs section.

## M24 — Metric control (size S)

- `cursus.define_metric(name, step_metric=..., goal="maximize|minimize",
summary=["min","max","last"])`: stored in run config namespace,
  honored by charts (goal drives sweep "best" + overlay defaults)
  and the workspace (goal-colored best markers — later).
- Custom step axes ride on M19's `x_key`; define_metric is the
  declaration half. Small, server-light (config JSON + chart props).

## M25 — Automations depth (size S–M)

- Metric-threshold triggers (in addition to run-state webhooks):
  `{"metric": "eval/acc", "op": ">=", "value": 0.9, "cooldown_s": 3600}`
  evaluated at log-batch time (cheap: summary compare, no extra
  queries), same signed-POST dispatch + SSRF guard as M8.
- Native Slack/Discord message formatting option (still webhooks
  underneath — formatting presets, not integrations).
- Per-project automation list UI (extends the webhooks surface).

## M26 — Runs-table depth + comments (size S)

- Group-by config key in the runs table; saved filter/sort presets
  (localStorage, per project).
- Run comments: append-only thread per run (new `RunComment` model,
  member-write gated, capped 200/run, rendered on Overview).
- Bulk compare beyond 5 (raise to 10, matching workspace).

## 3. Test strategy (per milestone, no exceptions)

- API: success + 401/403/404 + abuse cases (caps, races, SSRF where
  URLs enter). DB-gated, 60–90 s timeout convention.
- SDK: mocked-transport units + never-raises cases; integration suite
  where server behavior is involved.
- E2E journey: extend the critical path (one suite, growing
  assertions); GPU-dependent behavior covered at API/unit level only.
- Gates: `lint`, `lint:deps`, `lint:docs`, `typecheck`,
  `format:check`, `build`, `ruff`+`pytest`, Playwright.

## 4. Non-goals (restated, still out)

Launch/job orchestration, report builder, Weave-style tracing/evals,
billing/metering, SCIM, mobile app, multi-org-per-user. Each costs
more than everything above combined.
