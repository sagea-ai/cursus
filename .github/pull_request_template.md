## What

<!-- One paragraph: what changes for whom. Link the issue: Fixes #… -->

## Why

<!-- The problem, not the solution. Screenshots for UI changes. -->

## How it was verified

<!-- Commands run and their result. New tests are expected (CONTRIBUTING):
- [ ] `npm run lint` / `typecheck` / `format:check`
- [ ] `npm test` (+ `RUN_API_TESTS=1` if routes changed)
- [ ] `./scripts/e2e-local.sh` (UI or journey changes)
- [ ] `ruff` + `pytest` in `sdk/` (SDK changes)
-->

## Checklist

- [ ] No N+1 or unbounded queries (bounded budgets stated in code comments)
- [ ] Visibility filters extended, never forked (`runVisibilityFilter` /
      `projectVisibilityFilter` on every new read path)
- [ ] Auth through `requireRole()` only; both-role tests for gated routes
- [ ] No PRD-style planning docs added to `docs/` (`npm run lint:docs`)
- [ ] Docs updated (`docs/sdk.md` for SDK surface, `docs/ARCHITECTURE.md`
      for platform behavior, README for user-facing changes)
