# Cursus

A minimal, self-hostable experiment tracker — a barebones Weights & Biases.
Create a run, log scalars/config over time, view charts, compare runs, manage
your team. Nothing else. See [PRD.md](./PRD.md) for the full spec and
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the design rationale.

## What this is / isn't (honest version)

Cursus replaces W&B for scalar metrics + run metadata with team support
(super admin / member). It is **not** building: hyperparameter sweeps, a model
or dataset registry, multi-node run aggregation (log from rank 0 only),
per-project permissions or custom roles, report/notebook docs, alerting, or
system-metrics auto-capture. If you need those, Aim and MLflow are excellent
and occupy similar territory — Cursus trades their scope for a smaller codebase
and a `docker compose up` deploy story.

## Quickstart (self-host, < 10 min)

```bash
cp .env.example .env        # point DATABASE_URL at Postgres 16+
docker compose up -d db     # local Postgres
npx prisma migrate deploy   # schema
npm install && npm run dev  # dashboard at http://localhost:3000
```

SDK (distribution name `sagea-cursus` — `cursus` is taken on PyPI):

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

- `app/` — Next.js dashboard + `app/api/v1/` ingestion/team routes
- `lib/` — one Prisma client (`db.ts`), one auth guard (`auth.ts`), shared
  Zod validation (`validation.ts`), run/team/key/project services, pure
  downsampling/summary helpers with unit tests
- `prisma/schema.prisma` — source of truth for the data model (PRD §4)
- `sdk/` — `sagea_cursus` Python package (`init`/`log`/`finish`/`config`)
- `e2e/` — Playwright critical-journey suite (bootstrap → runs → compare →
  invite → restricted member)
- `tests/api/` — DB-backed route tests (success + 403/401/404 paths)

## Team & auth model

Two roles: super admin (invite/promote/demote/deactivate, revoke any key) and
member (projects, own keys, view everything — no private projects in v1).
First boot creates the org + super admin via `POST /api/v1/auth/bootstrap`
(empty-DB only); everyone else joins through invite links the admin copies
manually (no email infra in v1).

## Contributing

TypeScript strict, ESLint + Prettier, `ruff` for the SDK. Every feature ships
with tests — new code without a test is a review blocker. `npm run
lint && npm run typecheck && npm test`, plus `pytest` in `sdk/`. UI is
shadcn/ui + `react-icons` exclusively (`npm run lint:deps` enforces the ban on
`lucide-react` et al). Conventional Commits (`feat:`/`fix:`/`chore:`)
recommended.

Testing layers:

- `npm test` — pure unit + component tests, no database needed.
- `RUN_API_TESTS=1 DATABASE_URL=<throwaway-postgres> npm test` — route tests
  against a real database (isolated `test-*` orgs, cleaned up afterwards).
  Never point this at dev/prod.
- `sdk/pytest` — mocked-transport unit tests; `RUN_CURSUS_INTEGRATION=1`
  pytest `-m integration` hits a live server (opt-in).
- `./scripts/e2e-local.sh` — recreates the local `cursus_e2e` database,
  migrates, and runs the Playwright journey (needs a prior `npm run build`).
