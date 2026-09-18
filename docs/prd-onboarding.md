# Onboarding PRD: env-anchored, one-time root-admin setup

Status: Accepted (builds now) · Owner: Basab Jha (SAGEA Labs)

## 0. Background

Today the first account on a fresh instance is whoever wins a race to an
open `POST /api/v1/auth/bootstrap`: no identity check, no display name, no
password confirmation, no explicit one-time warning. The
`BOOTSTRAP_ADMIN_*` env vars exist but are unenforced, and local development
leans on a hard-coded demo seed (`dev@cursus.local`). That was fine for a
scaffold. It is not acceptable for a deployment the owner actually logs into:
whoever claims a fresh instance first owns it, permanently.

## 1. Goals

G1: Only the holder of the bootstrap email (`BOOTSTRAP_ADMIN_EMAIL`) can
complete onboarding. Everyone else gets a generic refusal that reveals
nothing.
G2: A guided first-run page collects name, org name, login email, and a
twice-entered password, with a strict, must-acknowledge disclaimer that
onboarding happens exactly once.
G3: After completion, onboarding is closed permanently: endpoint, page, and
an admin-panel status surface all agree it can never run again.
G4: An admin can permanently disable onboarding from the dashboard (defense
in depth, and an audit-visible guarantee).

## 2. Non-goals

- Email delivery of any kind (still manual, per the v1 invite model).
- Re-opening onboarding after completion (deliberately one-way, see §6).
- Renaming the org after the fact, editing another user's name, multiple
  admins at boot (invite covers all of that post-boot).
- A demo/seed account story for production (seed script stays dev-only).

## 3. Env contract

- `BOOTSTRAP_ADMIN_EMAIL` (required): the only address that may onboard.
  Compared trimmed and lowercased. If unset, onboarding refuses to run at
  all (fail closed) and the page says so plainly.
- `BOOTSTRAP_ORG_NAME` (optional): suggestion prefilled into the org-name
  field. The admin may change it; it is not verified.
- `BOOTSTRAP_ADMIN_PASSWORD`: REMOVED. An env-baked password contradicts
  interactive double-entry and would sit in shell history and compose
  files. Delete the line; the server never reads it.

## 4. Flow

`GET /onboarding` (public, outside the app shell):

1. Server checks, in order: onboarding flag (`GlobalSettings`) → any users
   exist → env email configured. Closed/misconfigured states redirect to
   `/login` (completed) or render a "not configured" card (missing env).
   The expected email address is never rendered or echoed.
2. Step 1: the claimant enters their email (client-side step only).
3. Step 2: name, role (SUPER_ADMIN preselected and locked, with a note that
   the first account must own the org), org name (prefilled suggestion,
   editable), login email (carried from step 1, read-only), password +
   confirm (min 8, must match, checked client-side AND server-side length).
4. Disclaimer block + required checkbox: "Onboarding can be completed
   exactly once. After this account is created, this page is permanently
   disabled and new accounts can only be created by invitation from a
   super admin."
5. Submit → `POST /api/v1/auth/bootstrap` → 201 sets the session cookie →
   land on the new org's projects page.

Server checks on POST (all must pass, in this order):

1. Flag set → 410 "onboarding is permanently disabled".
2. Env unset → 500 "onboarding is not configured".
3. Email mismatch → 403 generic ("not authorized for onboarding").
4. Users exist → 403 "already bootstrapped" (unique-email P2002 during the
   insert maps here too, closing the double-submit race).

On success the flag is set closed in the same flow that creates the org
and user.

## 5. Kill-switch (one-way by design)

`GlobalSettings.onboardingDisabled` (default false). Completion sets it
closed. The admin Settings page shows the status and, while it is somehow
still open, a "Disable permanently" button. There is deliberately NO
re-enable: with users present the endpoint refuses regardless, so a
re-open control would be a fake affordance — and the only scenario where
re-opening matters (wiped users table) already implies direct DB access,
which bypasses the UI anyway. `PATCH {disabled:false}` is rejected with 409. `GET/PATCH /api/v1/settings/onboarding` are super-admin-only.

## 6. Schema

- `User.name String @default("")` (display name; backfills existing rows).
- `GlobalSettings { id ("global"), onboardingDisabled Boolean @default(false) }`.

## 7. UI surfaces

- `/onboarding`: light split-screen shell shared with login (banner,
  artwork, card), two-step form, strict disclaimer + checkbox.
- Sidebar shows the user's name (email as fallback).
- Team table gains a Name column.
- `/[org]/settings`: super-admin-only page with the onboarding status card
  (members never see the nav item).

## 8. Tests

- API: disabled flag → 410; wrong email → 403 (deterministic: email is
  checked before the users-exist check); non-empty DB → 403; name persisted;
  settings GET/PATCH role matrix (member 403, anon 401, re-enable 409).
- Positive bootstrap path cannot run in the shared suite (parallel workers
  always see users) — covered by the Playwright journey on a fresh DB,
  which now drives the real onboarding UI instead of the raw endpoint.
- E2E env: `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ORG_NAME` wired through
  `scripts/e2e-local.sh`, playwright `webServer.env`, and the CI e2e job.
