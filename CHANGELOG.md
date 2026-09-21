# Changelog

All notable changes, newest first. Format follows Keep a Changelog;
versioning is SemVer from 1.0 onward (0.x may break APIs between minors).

## [Unreleased]

## [0.2.0] - 2026-09-21

Breaking: artifact uploads move to presigned S3 tickets (init/PUT/
complete, 1 GB files) — needs SDK 0.2+ and object storage configured.
New: per-run stdout/stderr log stream with viewer tab. Legacy DB-backed
artifact bytes keep downloading inline.

## [0.1.3] - 2026-09-20

Fix: `npm run build` generates the Prisma client first, so Vercel and
fresh checkouts build with no prior generate step.

## [0.1.2] - 2026-09-19

Fix: force-dynamic rendering app-wide so the Docker image builds with no
database reachable (GHCR publish was failing on build-time prerender).

## [0.1.1] - 2026-09-19

Patch: Connect card with the deployment base URL on API Keys, quickstart
snippets with the real URL baked in, full SDK usage snippets plus
runnable `sdk/examples/`, completed `docs/sdk.md` reference. No behavior
changes to the API or SDK surface.

## [0.1.0] - 2026-09-19

First open-source release: self-hostable experiment tracking (Next.js +
Postgres + S3-compatible storage) with a `requests`-only Python SDK.

### Experiment tracking

- Runs with config/tags/notes, four statuses, crash detection via
  heartbeat staleness, and a run detail page (charts, overview, config).
- Scalar metric logging with background batching, server downsampling,
  per-key charts, and run comparison with config diffs.
- Image logging (`log_image`) to object storage with a step-scrubbable
  viewer; versioned run artifacts (checkpoints, datasets).
- Grid/random sweeps with transactional worker-pull trials and a sweep
  detail page; mid-run config sync (debounced, flushed on finish).
- Per-run and project-level CSV/JSON export (streamed, visibility-scoped).

### Teams & access

- Super admin / member / viewer roles with hierarchical guards;
  read-only viewers with read-scoped API keys.
- Invite links (1-hour, single-use) with one-time display-name claim;
  Active/Pending/Inactive statuses; deactivate, reactivate, rename, and
  hard delete (content reassigned, never destroyed).
- Groups owning projects with inherited run visibility; OIDC SSO bridged
  into cookie sessions (JIT provisioning, invite activation, domain policy).
- API keys with rotation, revocation, per-key audit history, and live
  role enforcement.

### Platform

- Personal activity page (streaks, contribution grid, rhythm, records)
  and an org dashboard (activity, status mix, top projects, attention).
- Project retention: metric TTL, archival with write freeze, batched
  on-demand purges with dry-run previews.
- Run-state webhooks (HMAC-signed, SSRF-guarded) for finished/crashed runs.
- Self-host via Docker Compose (Postgres + MinIO + app + one-shot
  migrations) with bring-your-own S3/R2/GCS credentials.

[Unreleased]: https://github.com/sagea-ai/cursus/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/sagea-ai/cursus/releases/tag/v0.1.1
[0.1.0]: https://github.com/sagea-ai/cursus/releases/tag/v0.1.0
