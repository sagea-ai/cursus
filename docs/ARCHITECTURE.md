# Cursus architecture

Two components, one repo, two stores:

```
Python SDK ──HTTPS/JSON──▶ Next.js app (dashboard + API routes) ──▶ Postgres 16+
                                                                    └▶ S3 object storage
```

Postgres holds metadata + small relational rows. Large bytes (logged
images today, bulk exports tomorrow) live in S3-compatible object storage
— MinIO in compose for self-host, or bring your own (AWS/R2/GCS-XML) via
`S3_*` creds. Bytes never proxy through Next.js: the server mints
short-lived presigned URLs and clients PUT/GET direct to storage
(`lib/storage.ts`; bucket self-provisions on first use).

## Why Postgres rows for metrics (not a TSDB)

Metrics are rows in Postgres — not TimescaleDB/ClickHouse, not object storage.
At SAGEA's scale (dozens of runs, thousands of steps each, low tens of millions
of metric rows in year one) Postgres is more than sufficient, and it keeps the
self-host story to one app + one database. A dedicated TSDB is a legitimate v2
optimization once someone actually hits a wall — not something to pre-optimize
for. There is no relational-DB-free version of this system: run / metric /
project / org relationships and role checks need real joins and transactions.

## Write path (the hot path)

1. SDK batches client-side — flush every 5s or every 50 points, whichever first
   (`sdk/sagea_cursus/_batching.py`).
2. `POST /api/v1/runs/:id/log` does a **single bulk insert** per batch
   (`db.metric.createMany`), then merges `Run.summary` (last-known value per
   key) so the run list stays `O(runs)`, never `O(runs × metrics)`.
3. SDK network failures warn + drop after bounded retries in a background
   thread — logging **never blocks or crashes training** (hard requirement,
   explicit test in `sdk/tests/test_sdk.py`).

Metric rows are insert-only. The `Metric` PK is a `BigInt` autoincrement (not
cuid like every other table): the hot table wants a small sequential index;
public-facing IDs want non-guessable CUIDs. Deliberate asymmetry — see
`prisma/schema.prisma` header.

## Read path

- Run list: reads `Run.summary` only — never joins `Metric` (`lib/runs.ts`
  `listRuns`). Cursor-based pagination on `(startedAt, id)`.
- Charts: `GET /api/v1/runs/:id/metrics?key=…&max_points=…` reads
  `(runId, key, step)` via its index, then stride-downsamples server-side so a
  100k-step run never ships 100k points to the browser (`lib/downsampling.ts`).
- No N+1: every route uses one query with `select`/`include`.

## Auth (two modes, one surface)

- Dashboard: stateless HS256 JWT in an httpOnly cookie (`lib/session.ts`).
  No server-side session table in v1 (revocation on password change is a
  documented v2 gap, not an oversight).
- SDK/training scripts: `Authorization: Bearer <key>` — keys store only a
  SHA-256 hash, shown once on creation. Role is looked up **live** from the
  owning user per request, so demotion immediately restricts existing keys.
- Sessions get the same live-role treatment (`getLiveSession` in
  `lib/api-auth.ts`): the cookie is only an identity assertion; every guarded
  route re-reads the user row. A demoted/deactivated user loses access on
  their very next request — stale cookies grant nothing.
- One guard: `requireRole()` in `lib/auth.ts`. No inline role checks in routes.
- Keys are never valid for team-management endpoints (session-only by design;
  pinned by an explicit test).
- First boot: `POST /api/v1/auth/bootstrap` provisions the org + first super
  admin, allowed only while the users table is empty (permanently 403 after).
  No public signup; members join via invite links (stateless JWT, 1-hour
  expiry, single-use enforced by the invite-pending password sentinel).
- Team statuses derive from the password-hash sentinel, never a stored flag:
  usable hash = Active, `!invite-pending` = Pending, `!locked-…` = Inactive.
  Deactivation keeps the user row (run attribution survives) but locks the
  hash and revokes all keys; reactivation resets to invite-pending with a
  fresh link. Hard delete removes the row and reassigns owned runs,
  artifacts, groups, and audit entries to the acting admin — data is never
  destroyed with the account. The last super admin can be neither demoted,
  deactivated, nor deleted. Invitees claim their display name once on the
  accept page; afterwards only admins can rename (profile update strips
  `name`).
- Org slug (`Org.slug`) drives `/[org]/…` dashboard URLs — path-based, not
  subdomain, for self-hosters behind arbitrary reverse proxies.

## Groups & project visibility

- A group is an org subset that owns projects; runs inherit their
  project's visibility. A project with no group is org-wide public.
- One rule, enforced in `runVisibilityFilter` / `projectVisibilityFilter`
  (`lib/groups.ts`) on EVERY scoped read path (projects, runs, metrics,
  export, artifacts, stats): super admins see all; members see org-wide
  projects plus their groups' projects. Missing and hidden rows are the
  same 404 — no oracle for probing slugs or ids.
- Writes match reads: creating projects or logging runs inside a group
  requires membership (admins bypass); moving projects between groups is
  super-admin-only. Org-wide projects stay writable by every member.
- Deleting a group dissolves the boundary only: projects ungroup to
  org-wide (SetNull), member links vanish, history is never deleted.

## Pinned versions (M0, re-check each milestone)

- Next.js 16.3.5 (App Router), React 19.2.8, TypeScript 5.9.3
- Prisma ORM 7.10.0 — **not** Prisma 8 (RC at time of writing). Re-evaluate the
  Prisma 8 migration once it reaches stable, as a deliberate follow-up.
- Postgres 16+, Python 3.9+ with `requests` as the SDK's only hard dependency.

## What's explicitly out (v1)

Sweeps, model/dataset registry, multi-node aggregation (log from rank 0),
per-project ACLs / custom roles, report builder, alerting, system-metrics
auto-capture, multi-org-per-user. Feature requests get checked
against that list before acceptance.
