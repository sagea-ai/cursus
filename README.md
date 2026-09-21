# Cursus

[![CI](https://github.com/sagea-ai/cursus/actions/workflows/ci.yml/badge.svg)](https://github.com/sagea-ai/cursus/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-SAGEA_Noncommercial-lightgrey.svg)](./LICENSE)
[![PyPI](https://img.shields.io/pypi/v/sagea-cursus)](https://pypi.org/project/sagea-cursus/)

![Cursus banner](./assets/banner.png)

A self-hostable experiment tracker, a barebones Weights and Biases. Log
runs, metrics, images, and artifacts from training scripts; watch charts,
compare runs, run sweeps, and manage your team from one dashboard. One app
plus Postgres plus S3-compatible storage, deployed with
`docker compose up`.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the design
rationale and [docs/sdk.md](./docs/sdk.md) for the full SDK guide.

## Features

- **Runs**: config/tags/notes, live status, heartbeat staleness detection,
  detail pages with charts, overview, and config.
- **Metrics**: background-batched logging, server downsampling, per-key
  charts, run comparison with config diffs.
- **Media**: `log_image()` to object storage with a step-scrubbable viewer;
  versioned artifacts for checkpoints and datasets.
- **Sweeps**: grid/random search with transactional worker-pull trials.
- **Teams**: super admin / member / viewer roles, invite links, groups
  owning projects, OIDC SSO, API keys with audit history.
- **Your activity**: streaks, contribution grid, training rhythm, records.
- **Data control**: project exports (CSV/JSON), retention TTLs, archival,
  run-state webhooks.

## What this is not

Cursus trades scope for a small codebase. Out by design: model registry
with lineage, Bayesian sweeps, multi-node aggregation (log from rank 0),
custom roles, report builder, LLM tracing, SCIM, and billing. If you need
those, Aim and MLflow are excellent and occupy similar territory.

## Quickstart (self-host, under 10 min)

```bash
cp .env.example .env        # fill SESSION_SECRET + BOOTSTRAP_ADMIN_EMAIL
docker compose up -d db rustfs
npx prisma migrate deploy
npm install && npm run dev  # dashboard at http://localhost:3000
```

Open http://localhost:3000/onboarding to create the org and first super
admin, then invite the team from the Team page.

### Full stack with Docker (app + Postgres + RustFS)

```bash
export SESSION_SECRET="$(openssl rand -base64 32)"
export BOOTSTRAP_ADMIN_EMAIL="admin@example.com"
# Point the app at the compose services. Note: compose interpolates
# $DATABASE_URL from a repo .env file if one exists, so export it explicitly.
export DATABASE_URL="postgresql://cursus:cursus@db:5432/cursus?schema=public"
export S3_ENDPOINT="http://rustfs:9000"
export S3_PUBLIC_ENDPOINT="http://localhost:9000"
docker compose --profile selfhost up --build
```

This starts Postgres, RustFS (S3-compatible object storage for images),
runs migrations automatically, then the app on http://localhost:3000.
Prefer AWS/R2/GCS or another S3-compatible service? Point the `S3_*` variables at it
instead; no code changes needed. Prebuilt images ship per release at
`ghcr.io/sagea-ai/cursus`.

RustFS exposes its S3 API on port 9000 and console on port 9001. Set
`RUSTFS_ACCESS_KEY` and `RUSTFS_SECRET_KEY` to your credentials, and keep
`S3_ACCESS_KEY` / `S3_SECRET_KEY` aligned if you set them explicitly.
For remote clients, set `S3_PUBLIC_ENDPOINT` to a storage URL those clients
can reach (use HTTPS when the dashboard uses HTTPS). `S3_ENDPOINT` is the
server-reachable URL; both must point to the same storage service. For an
external provider, set both endpoints to that provider's URL.

If RustFS never becomes healthy after an unclean first start, its volume
can hold half-initialized state that hangs every later boot: recover with
`docker compose stop rustfs && docker volume rm cursus_cursus-rustfs`,
then start again (the bucket self-provisions on first upload). Warning:
this deletes any bytes already stored in that volume — only do it when
the volume never served traffic, or after moving uploads elsewhere.

#### Existing MinIO deployments

RustFS uses a new `cursus-rustfs` volume. Existing MinIO data is not migrated
automatically. Keep the old MinIO volume and a backup; copy objects through
the S3 API into RustFS, preserving bucket names and object keys, before
switching the app. Do not mount MinIO's data directory directly into RustFS.
Update old `.env` credentials and endpoints to match RustFS. Postgres
metadata and the Python SDK do not need a schema or API migration.

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fsagea-ai%2Fcursus&env=DATABASE_URL,SESSION_SECRET)

Point `DATABASE_URL` at a managed Postgres (Vercel Postgres, Neon, or
Supabase) and set `SESSION_SECRET` to a random value. Run migrations once
with `npx prisma migrate deploy` against that database. Media needs any
S3-compatible bucket via `S3_*`.

## SDK

Distribution name `sagea-cursus` (`cursus` is taken on PyPI).
Full usage guide: [`docs/sdk.md`](./docs/sdk.md).

```bash
pip install sagea-cursus
```

```python
import sagea_cursus as cursus  # keep the wandb-shaped ergonomics via alias

run = cursus.init(project="demo", config={"lr": 1e-4})
for step in range(100):
    cursus.log({"train/loss": 1.0 / (step + 1)}, step=step)
cursus.finish()
```

## Repo layout

- `app/`: Next.js dashboard + `app/api/v1/` routes (runs, sweeps, media,
  webhooks, team, export, auth)
- `lib/`: Prisma client, auth guard, validation, domain services
  (runs/sweeps/media/webhooks/retention/oidc), pure helpers with unit tests
- `prisma/schema.prisma`: source of truth for the data model
- `sdk/`: `sagea_cursus` Python package
- `docs/`: product docs only (`ARCHITECTURE.md`, `sdk.md`)
- `e2e/`: Playwright critical-journey suite
- `tests/api/`: DB-backed route tests (success + 403/401/404 paths)

## Team and auth model

Three roles: super admin (invite/promote/demote/deactivate/delete, revoke
any key), member (projects, sweeps, own keys, view everything), and viewer
(read-only: no writes, API keys read-scoped). Groups own projects with
inherited run visibility; OIDC SSO bridges into cookie sessions.
First boot creates the org + super admin via onboarding (empty-DB only);
everyone else joins through invite links the admin copies manually
(no email infra).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) (bar, suites, conventions),
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md), and
[SECURITY.md](./SECURITY.md) for vulnerability reports.

Testing layers:

- `npm test`: pure unit + component tests, no database needed.
- `RUN_API_TESTS=1 DATABASE_URL=<throwaway-postgres> npm test`: route tests
  against a real database (isolated `test-*` orgs, cleaned up afterwards).
  Never point this at dev/prod.
- `sdk/pytest`: mocked-transport unit tests; `RUN_CURSUS_INTEGRATION=1`
  pytest `-m integration` hits a live server (opt-in).
- `./scripts/e2e-local.sh`: recreates the local `cursus_e2e` database,
  migrates, and runs the Playwright journey (needs a prior `npm run build`).

## License

[SAGEA Noncommercial License v1.0](./LICENSE): free to use, copy, modify,
and distribute, but not for commercial sale.
