# Dashboard PRD: main landing interface (admin + member)

Status: Draft (verify before build) · Owner: Basab Jha (SAGEA Labs)

## 0. Problem

Logging in lands on the projects table. That answers "what projects exist"
but not the three questions anyone opens a tracker with: _what is running
right now, what needs my attention, and where do I go next?_ Admins and
members get the identical landing despite having different jobs (members:
train and check runs; admins: onboard people, watch the org). First-run
landing is especially dead: an empty table with no guidance.

## 1. Goals

G1: One glance answers running-now, recent activity, and next action.
G2: Admin and member see different dashboards from the same route —
same shell, role-gated widgets, no separate app.
G3: Fresh orgs get guided (SDK snippet, key, invite) instead of an empty grid.
G4: Every widget reads from bounded aggregate queries. No new N+1, no
unbounded row loads. The dashboard must stay fast at the §9 scale
target (tens of millions of metric rows) because it loads on every login.

## 2. Non-goals

- Customizable widgets, drag-drop layouts, saved views.
- Report/notebook builder, email digests, webhooks (see gap analysis).
- Realtime push (polling or per-load data only, per existing convention).
- New data model tables (everything derives from existing rows).

## 3. Route & nav

- New route `GET /[org]/dashboard`. Sidebar gains a **Dashboard** item at
  the top (above Projects), same embossed style.
- Root `/` redirects authed users to `/[org]/dashboard` (was: projects).
  Existing deep links (`/projects`, runs, etc.) are untouched.
- Login/onboarding flows unchanged, except post-login landing becomes the
  dashboard (E2E updated accordingly).

## 4. Widgets

### 4.1 Header

Greeting with display name ("Good evening, Basab" by local hour) + date.
Quick actions right-aligned: **New Project** (all roles), **Invite member**
(super admin only, opens the existing invite dialog flow).

### 4.2 Stat cards (one row, five cards)

Visible-runs total · Running now · Visible projects · My groups (member) or
Groups (admin, all) · Compute, summed durations formatted like project
totals. Every number respects group visibility (same filters as the
project stats — a member must not infer hidden runs from dashboard totals).

### 4.3 Org activity chart

Runs started per day, last 30 days, bar chart (recharts, already a dep).
One grouped query. Title: "Activity".

### 4.4 Two-column section

Left — **Recent runs** (8 newest visible runs: status badge, name link,
project, duration). Right, role-dependent:

- Member: **My groups** (name links + run counts; empty state points at
  asking an admin).
- Super admin: **Needs attention** — runs crashed in the last 7 days
  (name/project/time links) plus pending invites count linking to Team.
  Empty state: "All quiet."

### 4.5 Fresh-org getting started

Shown only when the org has zero runs (either role): three steps —

1. SDK snippet (existing quickstart block), 2) create API key link,
2. invite a teammate (admin) or "ask your admin for a group" (member).

## 5. Role matrix

| Widget                      | Member               | Super admin         |
| --------------------------- | -------------------- | ------------------- |
| Header + New Project        | yes                  | yes                 |
| Invite member shortcut      | no                   | yes                 |
| Stat cards (scoped counts)  | yes                  | yes (org-wide)      |
| Activity chart              | own-visible scope    | org-wide            |
| Recent runs                 | own-visible 8        | org 8               |
| My groups / Needs attention | groups               | attention           |
| Getting started             | yes (member wording) | yes (admin wording) |

## 6. Query budget (all bounded)

Single `Promise.all` in the page: projects-visible list (existing
`listProjects`), org run counts by status (`groupBy`), running count (same,
filtered), 30-day activity (`groupBy` date), 8 recent runs (indexed,
capped), crashed-7d (indexed, capped at 8), pending invites count,
member groups (existing `listGroups`). No per-row follow-ups. Compute sum
reuses the project-overview narrow-scan pattern (documented there).

## 7. Tests

- Service: new `getDashboardStats` unit-covered against visibility matrix
  (member counts exclude hidden; admin sees all) in `tests/api/`.
- E2E: extend journey — land on dashboard after login, assert greeting,
  stat cards, recent run link; member variant asserts no invite shortcut
  and scoped counts.
- Component: heatmap-free, so no new component tests beyond existing
  RTL patterns (stat cards render from props).
