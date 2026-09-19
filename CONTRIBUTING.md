# Contributing to Cursus

Thanks for considering a contribution. This project holds external
contributions to the same bar as internal ones — the bar is written down so
nobody has to guess.

## The bar (§10)

- **Every feature ships with tests.** New code without a corresponding test is
  a review blocker. Web: Vitest (+ React Testing Library for components,
  Playwright for journeys). SDK: pytest with mocked transport, plus opt-in
  integration against a live server.
- **TypeScript strict**, no `any` without a commented justification.
- **Lint + format are blocking**: `npm run lint`, `npm run format:check`
  (Prettier), `ruff check` + `ruff format --check` in `sdk/`.
- **`docs/` holds product docs only** (platform + SDK). Planning artifacts
  (PRDs, gap analyses, roadmaps) go in issues, never in `docs/` —
  `npm run lint:docs` enforces this in CI.
- **UI is shadcn/ui + react-icons only.** `npm run lint:deps` fails the build
  on `lucide-react`, MUI, Chakra, Ant, Mantine, etc. New shadcn-style
  primitives go in `components/ui/` using `cn()` from `lib/utils`.
- **Auth checks go through `requireRole()`** (`lib/auth.ts`) — never inline
  role comparisons in routes. New gated routes need both-role tests (member
  → 403 is a named test case, not an assumption).
- **No N+1 at the API layer**; new list views must read denormalized fields
  (e.g. `Run.summary`), never join the `Metric` table per row.
- **Check non-goals first** (README): sweeps, registries,
  per-project ACLs, alerting, etc. are out for v1. Changing non-goals
  needs maintainer agreement in the PR/issue, not just code.
- **Conventional Commits** (`feat:` / `fix:` / `chore:`) for changelog hygiene.

## Running the suites

```bash
npm run lint && npm run typecheck && npm test   # unit, no DB needed
RUN_API_TESTS=1 DATABASE_URL=<throwaway-pg> npm test   # route tests
./scripts/e2e-local.sh                          # Playwright journey (needs build)
cd sdk && ruff check . && ruff format --check . && pytest -q
```

API/E2E tests need a throwaway Postgres (`docker compose up -d db` plus a
scratch database + `npx prisma migrate deploy`). Never point them at dev/prod.

## Good first issues

- Empty-state and copy improvements on dashboard pages
- Additional chart affordances (log-scale toggle, per-chart max-points control)
- SDK docs examples and error-message wording
- `Run.summary` coverage for new at-a-glance columns (with tests)
