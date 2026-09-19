# PRD: W&B parity roadmap for Cursus

> Location note: this file lives at the repo root on purpose. `docs/`
> holds product documentation only (platform + SDK) — planning artifacts
> never go there (`npm run lint:docs` enforces it). This PRD is the plan,
> not the documentation.

## 0. Objective

Close the daily-use gaps between Cursus and Weights & Biases in build
order, without breaking what makes Cursus maintainable: Postgres-only,
bounded queries, visibility filters that extend but never fork, one auth
guard (`requireRole()`), tests per feature, and an SDK that never crashes
training. Each milestone is independently shippable; stop after any of
them and the product is still coherent.

Source gaps: media logging, sweeps, alerts, SDK breadth, export breadth,
viewer role, SSO, retention, config-update sync, platform ops. Explicitly
out (unchanged): report builder, Weave-style tracing/evals, Launch-style
job orchestration, model registry with lineage, billing/metering.

## 1. Ground rules (apply to every milestone)

- **G1 — Visibility extends, never forks.** New reads go through
  `runVisibilityFilter` / `projectVisibilityFilter` or they don't ship.
  Hidden rows stay indistinguishable 404s.
- **G2 — Auth through `requireRole()` only**, plus both-role tests
  (member → 403 is a named case). New roles extend the hierarchy, never
  inline checks.
- **G3 — Bounded queries with a stated budget.** GroupBys, capped lists,
  narrow scans, single-row counts. No N+1, no unbounded `include`.
- **G4 — SDK never raises except `init()`.** New SDK surface warns +
  drops on failure, is covered by a mocked-transport test, and adds no
  hard dependency (`requests` stays the only one; numpy/PIL are lazy
  optional imports).
- **G5 — Status model holds.** Member statues are Active/Pending/Inactive
  (hash-sentinel derived); deactivation stays reversible via re-invite;
  hard delete reassigns content to the acting admin. New lifecycle states
  (e.g. archived runs) follow the same reversible-first pattern.

---

## M6 — Image logging + viewer (P0, size M)

The single most-used non-scalar type in W&B. Audio/video/tables stay out
until images prove the storage + viewer pattern.

### Schema

New `MediaItem` model (not an artifact — different access pattern:
key/step addressed, rendered inline, never versioned):

```prisma
model MediaItem {
  id        String   @id @default(cuid())
  runId     String
  run       Run      @relation(fields: [runId], references: [id], onDelete: Cascade)
  key       String   // e.g. "val/samples"
  step      Int
  mime      String   // allowlist: image/png, image/jpeg, image/webp
  data      Bytes    // cap 5 MB per item (reject 413 above)
  createdAt DateTime @default(now())

  @@unique([runId, key, step])
  @@index([runId, key, step])
}
```

Cap: max 500 items per run (413 beyond; prevents a logging loop from
filling Postgres). Run deletion cascades (media dies with the run, unlike
artifacts which are project-scoped history).

### API (`app/api/v1/runs/[runId]/media/`)

- `POST` multipart (`key`, `step`, file): assertRunWritable gate,
  mime allowlist, 5 MB cap, upsert on `(runId, key, step)` (re-logging a
  step replaces — matches metric last-write intuition).
- `GET ?key=…&step=…` returns bytes with content-type; visibility read
  gate (same as metrics). List endpoint `GET ?key=…` returns
  `[{step, url}]` capped at 500, for the viewer strip.
- Summary: merge `media_keys: [...]` into `Run.summary` so lists know a
  run has images without joining.

### SDK

```python
cursus.log_image("val/samples", image, step=epoch)
```

`image` accepts a file path, `bytes`, or a PIL/numpy object (lazy
import — neither is a dependency; clear warning when neither is
installed and bytes/path wasn't given). Converts to PNG bytes
client-side. Never raises; warns + drops like `log()`.

### UI

Run detail Charts tab: per media key, a step slider over a single
`<img>` (no grid wall in v1 — one image at a time, step-scrubbable),
plus a thumbnail strip (max 24, lazy). Reuses the run-visibility gate;
no new page.

### Tests & acceptance

- API: upload/replace/caps (413 over 5 MB, 413 over 500 items),
  cross-org 404, member-write-own-group only, bytes round-trip.
- SDK mocked-transport: PIL/numpy/bytes/path inputs, failure drops.
- E2E: log via API, viewer shows image, slider moves steps.
- Accept: 100 PNGs (~200 KB) viewable with no list-view slowdown
  (summary-only reads hold).

## M7 — Sweeps, minimal (P0, size L)

Grid + random over a declared space with a worker loop. Bayesian later
or never. No hosted launcher — bring your own runner (the worker is an
SDK loop, not infrastructure).

### Schema

```prisma
model Sweep {
  id        String   @id @default(cuid())
  projectId String
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  name      String
  method    SweepMethod // GRID | RANDOM
  space     Json     // {"lr": {"values": [...]}} | {"lr": {"min":..,"max":..,"scale":"log"}}
  state     SweepState @default(RUNNING) // RUNNING | FINISHED | CANCELLED
  createdById String
  createdBy User     @relation(fields: [createdById], references: [id])
  createdAt DateTime @default(now())
}
// Run gains: sweepId String? + relation (SetNull — deleting a sweep
// unlinks runs, never deletes them).
```

Grid state (cursor) lives in `space` JSON (`_cursor` key, updated
transactionally on claim). Random is stateless.

### API

- `POST /api/v1/projects/:slug/sweeps` (member+, writable project):
  validates space schema (values[] | min/max(+scale), max 4 dims grid,
  max 10k grid combinations — 400 beyond).
- `POST /api/v1/sweeps/:id/next` (worker pull): atomically claims the
  next config (grid cursor transaction; random sample), returns
  `{run_config, trial}`. Returns 409 when grid is exhausted or sweep
  isn't RUNNING.
- `POST /api/v1/sweeps/:id/state` (admin/member-owner? — creator or
  super admin): FINISH/CANCEL.
- Runs created with `sweep_id` link; sweep reads enforce project
  visibility (a sweep in a hidden project is a 404).

### SDK

```python
sweep = cursus.create_sweep(
    "demo",
    {"lr": {"min": 1e-5, "max": 1e-1, "scale": "log"}},
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

`next_trial` returns `None` on exhaustion (409 → clean loop exit).
Same never-raises discipline for logging; `create_sweep`/`next_trial`
may raise (they're `init()`-class control calls).

### UI

Sweep detail page under the project: state badge + method/space summary,
member-runs table (reuses run rows + status badges), best-by-summary
(computed client-side from loaded rows, capped 100 — no new aggregate),
Finish/Cancel button for creator/admin. No parallel-coordinates plot in
v1 — the table plus per-run charts carry it.

### Tests & acceptance

- API: space validation 400s, grid exhaustion order + 409, random
  bounds/scale, concurrent `next` claims never double-issue (parallel
  test), cross-org 404, cancel stops claims.
- E2E: create grid sweep (2x2), run 4 trials via API loop, all linked,
  sweep page lists 4.
- Accept: 50-trial random sweep completes with zero double-issued
  grid cells under 8 concurrent workers.

## M8 — Run-state webhooks (P0, size S)

Crash/finish notifications without building Slack-native anything —
webhooks cover Slack via intermediaries. No in-app notification center.

### Schema

```prisma
model Webhook {
  id        String   @id @default(cuid())
  projectId String
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  url       String   // http(s) only; no localhost/169.254 (SSRF guard)
  events    String[] // subset of ["run.finished", "run.crashed"]
  secret    String   // HMAC-SHA256 signing key, shown once like API keys
  createdById String
  createdBy User     @relation(fields: [createdById], references: [id])
  createdAt DateTime @default(now())
}
```

### Behavior

- Dispatch from the run-finish path (`finishRun` service): after the
  status commits, POST `{event, run_id, project, status, finished_at,
url}` with `X-Cursus-Signature` HMAC + 5 s timeout, fire-and-settle:
  failures are swallowed (logged server-side only) — finishing a run
  must never fail because a webhook is down.
- CRUD routes: project members manage (writable project gate);
  super admin sees all. Secret rotation = delete + recreate (v1).
- SSRF guard: block non-http(s), localhost, loopback, link-local,
  and DNS that resolves to those (resolve-then-check at send time).

### Tests & acceptance

- API: CRUD perms, event-subset validation, SSRF 400s (localhost,
  169.254.88.99, resolved-loopback stub).
- Dispatch test with a local HTTP capture server: correct payload +
  valid HMAC; dead endpoint still finishes the run 200.
- E2E: create webhook, finish run crashed, capture receives event.
- Accept: 100 sequential finishes with a dead endpoint add < 500 ms
  p99 overhead each (timeout-bounded, non-blocking).

## M9 — Viewer role (P1, size M)

Third role for read-only stakeholders. Custom roles stay out.

### Auth model

`Role` gains `VIEWER`; `requireRole()` becomes hierarchical:
`SUPER_ADMIN > MEMBER > VIEWER` (a minimum-role parameter, defaulting
to today's exact behavior per route — audit every call site).

- Viewer can: read every project/run/metric/artifact/media visible to
  members (org-wide + own groups — viewers join groups like members),
  export, view dashboard/activity/profile.
- Viewer cannot: create runs or log (SDK keys for viewers are
  read-scoped — ingestion rejects), create projects/groups, invite,
  manage team/keys beyond own, comment/annotate (no notes edits).
- Invite flow gains a role picker (member/viewer, default member);
  bootstrap admin stays SUPER_ADMIN.
- Team page: role badge + promote/demote menu handle three states;
  last-super-admin guard unchanged; deactivation/delete unchanged.

### Migration

Prisma enum alter (`VIEWER` added — Postgres enum append, no rewrite).
Backfill: none (no existing viewers). Session JWTs carry the role, so
live-session re-reads pick it up with zero invalidation work.

### Tests & acceptance

- API matrix test: every write route × viewer → 403; every read route
  × viewer → 200 (parameterized over the route table — one test,
  full coverage).
- SDK: viewer key logging → 401/403, reads OK.
- E2E: invite viewer, accept, sidebar shows no New Project/Invite,
  row actions absent, run pages render.
- Accept: zero member/admin behavior changes (full suite green
  unchanged).

## M10 — Bulk run ops (P1, size S–M)

Multi-select in the runs table; transactional batch endpoints.

### API

- `POST /api/v1/projects/:slug/runs/batch` with
  `{ids: string[1..100], op: "delete" | "tag", tags?: string[]}`:
  single transaction, assertRunWritable per run (one hidden id fails
  the whole batch 404 — no partial writes, no oracle), returns
  `{affected}`.
- Delete cascades like single delete (metrics cascade; artifacts keep
  history via SetNull). Tag op merges tag sets.
- Rate/size guard: 100 ids max (400 beyond).

### UI

Runs table: checkbox column + selection bar (count, Tag…, Delete… with
the existing ConfirmDialog pattern). Selection clears on
filter/sort/page change (no cross-page selection state in v1).

### Tests & acceptance

- API: happy batch, 101 ids → 400, one-hidden-id → 404 + zero writes,
  member-outside-group → 404, cascade verification.
- E2E: select 3, tag, verify; select 2, delete, verify gone.
- Accept: 100-run batch completes in one transaction (< 5 s on local
  Postgres).

## M11 — SSO via OIDC (P1, size L)

One provider protocol, bridged into the existing cookie model. SCIM
stays out; invite links keep working alongside.

### Design

- Env-gated: `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
  (optional `OIDC_ALLOWED_DOMAINS`). Disabled by default — zero behavior
  change when unset.
- Flow: `/api/v1/auth/oidc/start` (state+nonce cookies) →
  provider → `/api/v1/auth/oidc/callback` (code exchange, ID-token
  verify via issuer JWKS, require `email_verified`). First login
  JIT-provisions a MEMBER in the single org (v1 has one org per
  deployment); existing email links the SSO subject to the account
  (`ssoSubject` column, nullable, unique).
- Sessions are the same HS256 cookie afterwards — every downstream
  guard (live session, roles, deactivation) applies unchanged.
  Password login keeps working for non-SSO accounts; SSO-linked
  accounts get a random unusable password (can't password-login
  around SSO).
- Login page shows "Sign in with SSO" only when configured.

### Tests & acceptance

- Callback unit tests with stubbed JWKS: valid provision, valid link,
  unverified-email 403, bad-nonce/state 400, domain-restricted 403.
- E2E against a stub OIDC provider (local): full loop to dashboard.
- Accept: with env unset, no route/UI change (existing auth suite
  green untouched); deactivation kills SSO sessions via the live
  guard like any other.

## M12 — Retention controls (P2, size M, on demand)

Per-project metric TTL + archival. No job queue in v1 — purging is an
explicit admin action, not a cron.

### Schema & behavior

- `Project` gains `metricsTtlDays Int?` (null = keep forever) and
  `archivedAt DateTime?`. Archived projects are read-only (writes 409)
  and render an Archived badge; unarchive restores.
- `POST /api/v1/projects/:slug/purge` (super admin): deletes `Metric`
  rows older than TTL for that project's runs (batched deletes,
  10k/batch, returns `{deleted}`), keeps runs + summaries + media.
  Dry-run flag returns the count without deleting.
- Dashboard/docs surface per-project storage (metric row counts already
  queryable) so admins know what TTL to set.

### Tests & acceptance

- API: TTL validation, archived-write 409s, dry-run vs real counts,
  member → 403, purge keeps summaries/media intact.
- E2E: age metrics, dry-run count, purge, charts show the gap honestly.
- Accept: 1 M-row purge completes without statement timeouts
  (batched, single project scope).

## M13 — Config update sync (P2, size S)

Close the loop the SDK already advertises (`cursus.config` is currently
local-only after `init`).

### API + SDK

- `PATCH /api/v1/runs/:id/config` `{config: object}`: shallow-or-deep?
  Deep-merge, last-write-wins, capped at 100 keys / 32 KB (400 beyond);
  assertRunWritable gate; allowed while RUNNING only (409 after finish
  — finished runs are history).
- SDK `RunConfig.update()` gains a debounced sync (5 s trailing, same
  never-raises discipline; failures warn). Flush on `finish()` so the
  final config always lands.

### Tests & acceptance

- API: deep-merge semantics, caps, finished-409, perms.
- SDK mocked: debounce timing, finish-flush, failure warn.
- E2E: update mid-run, Config tab shows merged values.
- Accept: 60 rapid updates produce ≤ 13 server writes (debounce holds).

## M14 — Export breadth (P1, size S)

Project-level bulk export (today: per-run CSV/JSON only).

- `GET /api/v1/projects/:slug/export?format=csv|json`: streaming
  response over the project's visible runs (visibility filter applies —
  members get their subset), cursor-paginated server-side, same batch
  streaming pattern as run export. Cap: 50k runs (400 beyond with a
  narrow-the-filter message).
- Reuses the run-export serializers row-wise; envelope carries project
  - export timestamp.
- Tests: stream integrity past batch boundaries, visibility subset,
  cap 400, anon 401. E2E: download + parse.

## 2. Build order & dependencies

```
M6 media ─┐
M8 webhooks│ (independent, any order)
M14 export ┘
        │
M7 sweeps ── needs runs/linkage only (after M6 optional)
M9 viewer ── auth-only, independent
M10 bulk ─── needs runs table UI (independent of others)
M11 SSO ──── auth-only, independent (biggest review surface)
M12 retention ── needs nothing; do when storage hurts
M13 config-sync ── small; anytime after M6
```

Suggested sequencing: M6 → M8 → M14 → M7 → M9 → M10 → M13 → M11 → M12.
SSO late (largest review surface, needed only on demand); retention
last (only when storage actually hurts).

## 3. Test strategy (per milestone, no exceptions)

- API suite: success + 401/403/404 paths + the milestone's abuse cases
  (caps, exhaustion, SSRF, double-claim races). DB-gated, 60 s timeout
  convention for heavy tests.
- SDK: mocked-transport unit tests + never-raises cases; integration
  suite extended where server behavior is involved.
- E2E journey: extend the critical path (never a second journey —
  one suite, growing assertions).
- Gates stay green throughout: `lint`, `lint:deps`, `lint:docs`,
  `typecheck`, `format:check`, `build`, `ruff`+`pytest`, Playwright.

## 4. Non-goals (restated, still out)

Report builder, LLM tracing/evals, job orchestration/Launch, model
registry with lineage/aliases, billing/metering, custom roles, SCIM,
multi-org-per-user, hosted control plane. Each would cost more than
everything above combined.
