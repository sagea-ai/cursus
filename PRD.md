Cursus — Product Requirements Document
Status: Draft v2 Owner: Basab Jha (SAGEA Labs) Doc type: Engineering PRD Target: Open-source release under SAGEA

0. TL;DR
Build a minimal, self-hostable experiment tracking system — a "barebones W&B." Two components:

Cursus Server — a Next.js web app (dashboard + API routes) for storing and visualizing training runs, with team/org support (a super admin and member roles). Ships as a Vercel-deployable app and a single Dockerfile for self-hosting.
Cursus SDK — a small Python package (PyPI name TBD — see §8.5, cursus itself is taken) that mirrors wandb.init() / wandb.log() / wandb.finish() ergonomics, POSTing metrics to the server over HTTP.
No sweeps, no model registry, no artifact lineage graphs, no fine-grained per-project permissions beyond the two-role model in §5. Just: create a run, log scalar/config data over time, view it in a chart, compare a handful of runs, manage who's on the team. Everything else is explicitly deferred (§2).

This is a v2 draft of the PRD: it locks several decisions that were previously open (ORM, chart library, icon library, pinned framework versions), adds the teams/RBAC feature, adds a full UX specification, and adds an explicit engineering-standards section, since this ships publicly as an OSS project and needs to read like one from day one — not get cleaned up later.

1. Problem & Goals
1.1 Problem
SAGEA runs training jobs across the SAGE and VORA model families on internal infra. Right now there's no experiment tracking — comparing runs means digging through log files or ad hoc CSVs. W&B solves this but is a SaaS dependency with cost, data-residency, and vendor-lock concerns for a company whose thesis is not depending on foreign infra where avoidable. We also want a credible OSS artifact under the SAGEA name — something that demonstrates product engineering chops, not just model work. A repo full of amateur code undermines that goal as badly as not shipping at all.

1.2 Goals
G1: Replace W&B for SAGEA's internal experiment tracking needs (scalar metrics + run metadata).
G2: Ship as OSS — clean, tested, documented enough that outside contributors could plausibly use or contribute to it without embarrassment.
G3: Trivial to self-host (docker run) or deploy to Vercel + a managed Postgres in under 10 minutes.
G4: SDK integration should be a 3-line diff in an existing training script (drop-in muscle memory for anyone who's used wandb).
G5: Keep the surface area small enough that one engineer can maintain it.
G6: Support basic team collaboration (one org, a super admin, and members) without turning into a permissions system nobody asked for.
1.3 Non-goals (v1)
Explicitly not building, and this should be stated in the README to manage contributor expectations:

Hyperparameter sweeps / sweep agents
Model registry, artifact versioning, dataset versioning
Distributed run coordination (multi-node rank aggregation) — log from rank 0 only, document this
Fine-grained per-project permissions, custom roles, or role hierarchies beyond super admin / member (§5)
Report-builder / notebook-style docs
Alerting, Slack/webhook integrations (candidate for v2, not v1)
System metrics auto-capture (GPU/CPU/mem) — stretch goal, see §7 backlog, not a blocker
Multi-org-per-user (a user belongs to exactly one org in v1 — simplifies auth considerably, revisit only if actually needed)
1.4 Success metrics
SAGEA's own training runs (SAGE + VORA family) are 100% tracked in Cursus within 4 weeks of M2 shipping, W&B fully decommissioned internally.
Cold-start self-host (clone → running dashboard) achievable in < 10 minutes by someone who has never seen the repo, verified by a non-author dry run.
pip install <sdk-name> && cursus.init() to first metric visible in UI in < 5 minutes.
CI is green on main at all times; no merged PR ever ships without passing tests (§10).
2. Users & Usage Shape
Primary user: SAGEA ML engineers running training/fine-tuning jobs (PyTorch-centric, occasionally JAX) on internal GPU boxes or cloud instances, who want to cursus.log({"loss": 0.4}, step=100) inside their training loop and see a live chart. Some of these users are super admins (can invite teammates, manage API keys org-wide); most are members (can create projects and their own API keys, log runs, view everything in the org).

Secondary user (OSS angle): an external engineer who wants a self-hosted, no-nonsense tracker without W&B's org/billing complexity, and is willing to trade features for simplicity and control of their own data. This user cares about code quality when deciding whether to trust/adopt/contribute — see §10.

Usage shape is bursty and write-heavy during training (metrics logged every N steps, potentially several times/sec from a single run) and read-light (a handful of dashboard views per run, mostly line charts). Admin/team actions (inviting members, rotating keys) are rare and low-throughput — they should be correct and safe, not optimized for volume.

3. System Architecture
┌─────────────────────┐        HTTPS/JSON          ┌──────────────────────────┐
│  Python SDK           │ ───────────────────────▶  │  Next.js App              │
│  (cursus)              │   POST /api/v1/runs        │  - API routes (ingest)    │
│  - init()              │   POST /api/v1/runs/:id/log │  - Dashboard (RSC + CSR)  │
│  - log()               │   POST /api/v1/runs/:id/fin │  - Auth (sessions + keys) │
│  - finish()            │                             │  - Team/RBAC             │
└─────────────────────┘                             └───────────┬──────────────┘
                                                                  │  Prisma ORM
                                                                  ▼
                                                         ┌──────────────────┐
                                                         │  Postgres 16+      │
                                                         │  - orgs, users     │
                                                         │  - projects, runs  │
                                                         │  - metrics (rows)  │
                                                         │  - api_keys        │
                                                         └──────────────────┘
Key architectural decision: metrics are rows in Postgres, not a time-series DB, not object storage. For SAGEA's actual scale (dozens of runs, thousands of steps per run, low tens of millions of metric rows total in year one) Postgres is more than sufficient and keeps the self-host story to "one Docker Compose with one database." A dedicated TSDB (ClickHouse, TimescaleDB) is a legitimate v2 optimization once someone actually hits a wall — don't pre-optimize for a problem SAGEA doesn't have. Document this tradeoff explicitly in the architecture doc so it doesn't look like an oversight. This is a hard requirement, not something to reconsider mid-build: there is no relational-DB-free version of this system, because run/metric/project/org relationships and role checks need real joins and real transactions.

3.1 Components
Component	Tech	Notes
Web app + API	Next.js 16.2.x (App Router), TypeScript 5.9.x, React 19.2.x	Latest stable line as of this writing. API routes double as the ingestion endpoint — no separate backend service. Pin exact patch version in package.json at M0 kickoff and re-check before each milestone, since this line ships frequently.
ORM	Prisma ORM 7.x (latest stable, currently 7.10.x)	Locked in — no longer an open decision. Prisma 8 exists only as a release candidate at time of writing; do not build on an RC for a project meant to be a stable public reference implementation. Re-evaluate the Prisma 8 migration once it reaches a stable release, as a deliberate follow-up task, not a default.
DB	Postgres 16+	Required, not optional (see above). Relational store for orgs/users/projects/runs/metrics/api_keys.
UI components	shadcn/ui — exclusively	Hard constraint: no MUI, Chakra, Ant Design, Mantine, or bespoke unstyled components. Every interactive element (tables, dialogs, dropdowns, tabs, badges, command palette, forms) is composed from shadcn/ui primitives.
Icons	react-icons — exclusively	shadcn/ui's default examples assume lucide-react; this project overrides that default. Every generated shadcn component that references lucide-react icons gets its imports swapped to the equivalent react-icons set (primarily react-icons/fi for a clean, consistent line-icon look matching shadcn's visual weight) as part of the component's initial commit — not left mixed. lucide-react must not appear in package.json at all; enforce this with a lint rule / CI check (§10.4), not just a convention.
Charts	shadcn/ui chart component (Recharts under the hood)	Follows from the shadcn-only constraint. uPlot is excluded despite better raw perf at high point counts, since it isn't a shadcn primitive — documented v2 tradeoff if it becomes a real bottleneck (§9).
Auth	Session-based (dashboard login) + API keys (server-to-server, SDK)	No OAuth/SSO in v1. Sessions carry userId + role; API keys are scoped to an org and inherit the creating user's role for authorization checks.
SDK	Python 3.9+, requests only as hard dependency	No async, no gRPC, no protobuf — keep dependency footprint tiny.
Testing	Vitest + React Testing Library (web), Pytest (SDK), Playwright (E2E)	See §10 — every feature ships with tests, not as an afterthought.
Deployment	Vercel (managed) or Dockerfile (self-host)	Same codebase, two deploy targets.
4. Data Model
Minimal relational schema, now including team/role support. This is the actual contract the whole system is built around — get this right before writing UI. Shown as Prisma schema notation since that's the source of truth in the repo (prisma/schema.prisma), not a separate ERD that can drift from it.

enum Role {
  SUPER_ADMIN   // exactly the org's root account(s); can manage members, rotate/revoke any key, delete anything
  MEMBER        // can create projects, create/manage their own API keys, log runs, view everything in the org
}

enum RunStatus {
  RUNNING
  FINISHED
  CRASHED
  KILLED
}

model Org {
  id        String    @id @default(cuid())
  name      String
  createdAt DateTime  @default(now())
  users     User[]
  projects  Project[]
  apiKeys   ApiKey[]
}

model User {
  id           String    @id @default(cuid())
  orgId        String
  org          Org       @relation(fields: [orgId], references: [id])
  email        String    @unique
  passwordHash String
  role         Role      @default(MEMBER)
  createdAt    DateTime  @default(now())
  apiKeys      ApiKey[]
  runsCreated  Run[]

  @@index([orgId])
}

model ApiKey {
  id         String    @id @default(cuid())
  orgId      String
  org        Org       @relation(fields: [orgId], references: [id])
  userId     String
  user       User      @relation(fields: [userId], references: [id])
  keyHash    String    @unique   // never store plaintext; show once on creation
  label      String              // human-readable, e.g. "training-box-1"
  createdAt  DateTime  @default(now())
  lastUsedAt DateTime?
  revokedAt  DateTime?           // soft revoke, never hard-delete a key (audit trail)

  @@index([orgId])
  @@index([userId])
}

model Project {
  id        String   @id @default(cuid())
  orgId     String
  org       Org      @relation(fields: [orgId], references: [id])
  slug      String
  name      String
  createdAt DateTime @default(now())
  runs      Run[]

  @@unique([orgId, slug])
}

model Run {
  id          String     @id @default(cuid())
  projectId   String
  project     Project    @relation(fields: [projectId], references: [id])
  name        String
  status      RunStatus  @default(RUNNING)
  config      Json       @default("{}")
  tags        String[]   @default([])
  summary     Json       @default("{}")   // denormalized last-known value per metric key, for fast list views
  createdById String
  createdBy   User       @relation(fields: [createdById], references: [id])
  startedAt   DateTime   @default(now())
  finishedAt  DateTime?
  updatedAt   DateTime   @updatedAt        // heartbeat target, see §6.3

  metrics     Metric[]

  @@index([projectId])
  @@index([status])
}

model Metric {
  id       BigInt   @id @default(autoincrement())
  runId    String
  run      Run      @relation(fields: [runId], references: [id])
  key      String
  step     Int
  value    Float
  wallTime DateTime @default(now())

  @@index([runId, key, step])
}
Notes:

config and summary as Json keeps the schema flexible without needing per-metric-key migrations — this is what W&B does conceptually, and it's the right call for a system where users log arbitrary keys.
Metric uses a BigInt autoincrement PK, not cuid() — it's the highest-volume table by orders of magnitude, and a sequential integer PK is smaller and faster to index than a text CUID here. Every other table uses cuid() for safer, non-guessable public-facing IDs (run URLs, project URLs). This is a deliberate asymmetry, not an inconsistency — call it out in a schema comment so a future contributor doesn't "fix" it.
Metric rows are insert-only, never updated. This matters for the ingestion design (§6.2) and means no updatedAt field is needed on that model.
One org per user (v1 simplification, §1.3) means User.orgId is a plain required field, not a join table — keeps every authorization check a single-column comparison instead of a membership lookup.
5. Teams & Roles (RBAC)
5.1 Model
Exactly two roles, org-scoped:

SUPER_ADMIN — the org's root account. Created implicitly as the first user when an org is created (there's no separate "create org" flow open to the public in v1 — an org is provisioned once, e.g. by whoever stands up the self-hosted instance, and that person becomes the first super admin). A super admin can:
Invite new members (creates a User row with a one-time invite token / temp password flow — see §5.3)
Promote a member to SUPER_ADMIN or demote a SUPER_ADMIN to MEMBER (except: cannot demote themself if they're the org's last remaining super admin — always keep at least one)
Deactivate/remove a user
Revoke any user's API key, not just their own
Do everything a member can do (create projects, log runs, create their own keys)
MEMBER — the default role for anyone invited. A member can:
Create projects
Create and revoke their own API keys only
View every project, run, and metric in the org (v1 has no per-project visibility restriction — see §1.3 non-goals; this is deliberate, not an oversight, and should be called out clearly in docs so nobody assumes private projects exist)
Cannot manage other users, cannot touch other users' API keys, cannot see a billing/admin panel that doesn't exist anyway
5.2 Authorization enforcement
Every mutating API route and server action checks role via the authenticated session (getServerSession equivalent) or, for SDK requests, the API key's owning user's role — at the data-access layer, not just hidden in the UI. A member calling a super-admin-only endpoint directly (curl, not the dashboard) must get a 403, full stop. Hiding a button in the UI is not authorization.
Centralize this in one place: a small requireRole(session, Role.SUPER_ADMIN) guard function used at the top of every admin route handler, not copy-pasted role-check if statements scattered across files (this is the DRY principle applied directly to the highest-stakes code path in the system — auth logic duplicated across routes is exactly how privilege-escalation bugs happen).
API keys inherit the creating user's role at creation time, snapshotted or looked-up live — decide in M0 whether a key should be revoked automatically on demotion (recommended: look up the live role on every request rather than snapshotting, so a demoted user's existing keys immediately lose elevated access — simpler mental model, one extra join, worth it).
5.3 Member invite flow
Super admin enters an email on the Team settings page.
Server creates a User row with role = MEMBER, no usable password yet, and issues a signed, time-limited invite token.
(v1, no email sending infra assumed) — the invite link is shown directly to the super admin to copy/send manually. Actual transactional email (Resend/Postmark integration) is a documented v2 nice-to-have, not a v1 requirement — don't build an email pipeline for a feature that can be one manual copy-paste for a small team.
Invitee opens the link, sets a password, lands in the dashboard as a member of the org.
5.4 What's explicitly out of scope here (restate from §1.3)
No custom roles, no per-project ACLs, no "viewer" read-only role, no SSO/SCIM provisioning. If SAGEA's own team outgrows this, that's a v2 conversation with real usage data behind it — not something to speculatively build now.

6. API Design (ingestion + team management contract)
REST, JSON. Two auth modes on the same API surface:

Session cookie — dashboard-originated requests (browser).
API key (Authorization: Bearer <key>) — SDK-originated requests (training scripts). API keys are never valid for team-management endpoints (§6.2) — those are session-only, dashboard-only, by design, since key-based team management from a training script is a footgun nobody needs.
6.1 Ingestion (SDK-facing, API-key auth)
POST /api/v1/runs
  body: { project: "sage-oss-40b-pretrain", name?: "run-1234", config?: {...}, tags?: [...] }
  returns: { run_id, name, url }

POST /api/v1/runs/:run_id/log
  body (batch form): { points: [ {key, step, value, wall_time}, ... ] }
  returns: 202 Accepted (fire-and-forget from SDK's perspective, don't block training loop)

POST /api/v1/runs/:run_id/finish
  body: { status: "finished" | "crashed" | "killed" }
  returns: 200

PATCH /api/v1/runs/:run_id/heartbeat
  -- called periodically by SDK; if no heartbeat for N minutes, server can mark run
     'crashed' for UI purposes (dead-run detection without relying on client-side finish())

GET /api/v1/projects/:project/runs           (list, dashboard uses this)
GET /api/v1/runs/:run_id/metrics?key=train/loss   (chart data)
6.2 Team management (dashboard-facing, session auth, role-gated)
GET    /api/v1/team/members                    (any member: list org members)
POST   /api/v1/team/invite                      (SUPER_ADMIN only: {email} -> invite token)
PATCH  /api/v1/team/members/:user_id/role        (SUPER_ADMIN only: {role})
DELETE /api/v1/team/members/:user_id             (SUPER_ADMIN only: deactivate)

GET    /api/v1/keys                              (member: list own keys; SUPER_ADMIN: list all org keys)
POST   /api/v1/keys                              (member: create own key; body: {label})
DELETE /api/v1/keys/:key_id                       (member: revoke own key; SUPER_ADMIN: revoke any org key)
Design constraint: logging must never block or crash a training job. SDK network failures should log a warning to stdout and drop the point (or retry a bounded number of times in a background thread), never raise into user code. This is the single most important reliability property of the SDK — a tracker that can OOM-kill or hang a training run is worse than no tracker.

7. UX Specification
This section describes the actual screens, states, and flows — detailed enough that a designer or engineer could build from it without guessing. Visual language recap (§3.1, §5 of the previous draft): dark-mode-first, shadcn/ui primitives only, react-icons, SAGEA blue accent family (#1976FD / #0050FD / #0235AD / #043091, lighter accents #45AAFD / #75C4FD, white as secondary) on a near-black background — W&B's density and layout patterns, not its palette.

7.1 Information architecture
/login
/invite/:token                       (accept invite, set password)
/[org]/projects                      (project list — landing page after login)
/[org]/[project]/runs                (run list for one project)
/[org]/[project]/runs/[run]          (run detail — the core screen)
/[org]/team                          (member list; SUPER_ADMIN sees invite/manage controls)
/[org]/settings/keys                 (API key management — own keys, or all org keys if SUPER_ADMIN)
Org slug is in the URL path (not a subdomain) — simpler for self-hosters running behind arbitrary domains/reverse proxies, no wildcard DNS/cert requirement.

7.2 Global layout
Left sidebar (persistent, collapsible): org switcher stub (v1 has one org per deployment context, so this is really just an org name + logo, not a switcher — don't build multi-org UI for a single-org data model), then nav: Projects, Team, Settings. Bottom of sidebar: current user avatar/email + sign-out.
Top bar (per-page): breadcrumb (Org / Project / Run), contextual actions (e.g. "New Project" button, "Compare" toggle on run list).
Empty states matter for a new self-host: "No projects yet" screen includes the exact curl/SDK snippet to create a first run, not just a bare "create a project" button — the fastest path to a first project is actually just calling cursor.init() from a script, since a run's POST /runs call upserts the project if it doesn't exist yet (document this upsert-on-first-log behavior explicitly — it's a deliberate convenience, not an oversight, mirroring how W&B itself works: you rarely "create a project" as a standalone action).
7.3 Login / Invite acceptance
/login: email + password, shadcn Form + Input + Button. No "sign up" link — v1 has no public self-serve org creation (§5.1); accounts exist only via invite or initial org bootstrap.
/invite/:token: shows the inviting org's name, email (pre-filled, read-only), password + confirm-password fields. Expired/used token → clear error state with no way to retry (super admin must re-invite).
7.4 Projects list (/[org]/projects)
Grid or table of project cards: name, run count, last-run timestamp, small status distribution (e.g. "3 running, 12 finished, 1 crashed") as a compact set of shadcn Badges.
Sort by last activity by default (most recently active project first) — this is the "what should I look at today" view, optimize for that.
"New Project" opens a shadcn Dialog with a name field (slug auto-derived, editable).
7.5 Run list (/[org]/[project]/runs)
This is W&B's dense run table, structurally: a shadcn Table with columns — [checkbox] | status badge | name | tags | created by | started | duration | key summary metrics (last value) | ⋯ actions

Row checkbox selection (2–5 rows) enables a "Compare" button in the top bar, which navigates to the compare view (§7.7) with selected run IDs in the query string — shareable link.
Status badge uses semantic but on-brand coloring: running = blue pulse (SAGEA accent, subtly animated), finished = neutral/white-on-dark, crashed = a clearly distinct warning tone (still within a restrained palette — don't reach for W&B's or anyone else's specific red/orange; pick one warning color and use it consistently across the whole app, defined once as a CSS variable).
Filter bar: tag filter (multi-select), status filter, text search on run name — all client-side against the already-fetched page for v1 (no need for server-side search infra at this data volume).
Column values for "key summary metrics" are pulled from Run.summary (denormalized JSON) specifically so this table never has to join against the full Metric table just to render a list — this is a direct performance consequence of the data model in §4, call out the connection in code comments where summary gets written.
7.6 Run detail (/[org]/[project]/runs/[run])
Header: run name (editable inline), status badge, tags (editable, shadcn Badge + inline add), created-by, started/duration.
Two tabs (shadcn Tabs): Charts (default) and Config.
Charts tab: masonry/grid of small multi-line charts, one per metric key (or grouped by prefix — train/* together, eval/* together, mirroring how users namespace keys like train/loss, eval/accuracy). Each chart: shadcn chart component, x-axis = step, hover tooltip shows exact value + step. Click-to-expand a chart to full width for closer inspection.
Config tab: read-only key/value viewer of the config JSON logged at init() — rendered as a simple nested tree/table, not a raw JSON blob dump (still legible for a human skimming hyperparameters).
No edit access to metric data itself anywhere in the UI — metrics are append-only from the SDK's perspective and the UI reflects that (this is a direct, intentional consequence of the insert-only Metric model in §4).
7.7 Compare view
URL: /[org]/[project]/runs/compare?ids=run1,run2,run3
Same masonry chart grid as run detail, but each chart overlays one line per selected run, color-coded consistently across all charts on the page (run A is always the same accent shade everywhere on this screen) with a shared legend at the top instead of per-chart.
Config diff: a compact table showing only the config keys that differ across the selected runs (keys with identical values across all selected runs are collapsed/hidden by default, expandable) — this is the actual useful comparison, not a full side-by-side dump of every hyperparameter.
7.8 Team (/[org]/team)
Table: avatar/email, role badge, joined date, last active. SUPER_ADMIN sees a row-level action menu (change role, remove); MEMBER sees this as a read-only list (no action menu at all — not a disabled one, an absent one, so it's visually obvious what a member can and can't do here).
"Invite Member" button (SUPER_ADMIN only) opens a dialog: email field → generates invite link, shown in a copyable code block (§5.3 — no email sending in v1).
7.9 API Keys (/[org]/settings/keys)
Member view: their own keys only — label, created date, last used, revoke button. "Create Key" dialog: label field → key shown exactly once in a copyable, monospace field with an explicit "you won't see this again" warning (standard, non-negotiable pattern for any secret-issuing UI — this is a security requirement, not a UX nicety).
Super admin view: same table, but scoped to the whole org, with an extra "owner" column, and the ability to revoke any key (with a confirmation dialog naming whose key and what it's used for, since revoking someone else's key can break their running training job).
7.10 Responsive/scale notes
Dashboard is desktop-first (this is a tool used at a workstation next to a training job, not on mobile) but must not break at laptop widths (1280px is the practical minimum target) — no fixed-width layouts that overflow.
Run list and compare view must stay usable with hundreds of runs per project and tens of thousands of steps per run — this is a direct UX consequence of the scalability requirements in §9, not a separate concern: pagination on the run list (cursor-based, not offset — see §9), and chart downsampling on the client for runs with very high step counts (render at most a few thousand points per line, downsample server-side or client-side rather than shipping 50k raw points to a <svg>).
8. Python SDK
Target API surface, deliberately matching wandb's shape so the mental model transfers 1:1:

import cursus

run = cursus.init(
    project="sage-oss-40b-pretrain",
    config={"lr": 1e-4, "batch_size": 32},
    name="run-1234",          # optional
)

for step in range(num_steps):
    ...
    cursus.log({"train/loss": loss.item(), "train/lr": current_lr}, step=step)

cursus.finish()
8.1 Design constraints
cursus.init() reads the API key from a CURSUS_API_KEY env var (or ~/.cursus/config), mirroring WANDB_API_KEY.
Global module-level run singleton, matching wandb's ergonomics (most users never touch a Run object directly). The singleton is implemented once behind a thin module-level API — init/log/finish are the only public surface; everything else (batching, retry, heartbeat thread) is private implementation detail, not exposed, to keep the public contract genuinely barebones.
Hard dependency: requests only. No optional-dependency creep in v1.
Background flush thread using a simple queue + timer, not asyncio — keeps it usable in every training script including ones without an event loop.
cursus.config is mutable and updatable mid-run (cursus.config.update(...)), matching wandb — cheap to support from day one, annoying to retrofit later.
Never block or crash the training process. Network failures during log() are caught, logged as a warnings.warn(...), and dropped (after a small bounded retry) — never raised into user code. This is the single most important reliability property of the SDK, restated from §6, because it's easy to deprioritize until it causes an actual incident.
8.2 Internal structure (DRY, testable)
_client.py — the only place that constructs HTTP requests and reads the API key/base URL. Every public function funnels through this one client instance; no ad hoc requests.post(...) calls scattered elsewhere in the codebase.
_batching.py — the flush-queue logic, unit-testable in isolation with a fake client (no real HTTP in unit tests — see §10.2).
_run.py — the Run object and the module-level singleton wiring.
Public __init__.py re-exports only init, log, finish, config — everything else is underscore-prefixed and considered private, enforced by __all__.
8.3 SDK versioning & compatibility
SemVer from 0.1.0. The /api/v1/... server routes are versioned independently of the SDK's own version — an SDK major bump is only forced by an actual breaking change to the v1 API contract, not by unrelated server changes.
SDK pins a minimum compatible server API version and fails loudly (not silently) on init() if the server reports an incompatible version, rather than producing confusing downstream errors mid-training-run.
8.4 Distribution
Published to PyPI. See §8.5 for the naming resolution — cursus the package name is unavailable.
8.5 Open — package naming
cursus is already taken on PyPI by an unrelated SageMaker pipeline-generation tool (confusingly adjacent domain). Ship the SDK under a prefixed/scoped distribution name instead — e.g. sagea-cursus or pycursus — confirmed against PyPI and a matching GitHub org/repo slug before anything is referenced publicly. The product is still branded "Cursus"; only the PyPI import name needs to differ, so the actual import statement (import sagea_cursus as cursus, aliased locally to keep the ergonomic surface identical) should be finalized in M0, not left implicit.

9. Scalability
Scale target, stated explicitly so "handle scale" isn't vague: comfortably support an org with dozens of concurrent runs, hundreds of projects, and tens of millions of metric rows, on a single mid-sized Postgres instance, without architectural changes. This is not "web-scale" — it's "don't fall over at the scale a real, growing ML org actually produces," and every decision below is calibrated to that, not to a hypothetical much larger workload.

Ingestion is insert-only and batched. The SDK batches points client-side (flush every 5s or every 50 points, whichever first) and the server does a single bulk insert per batch (createMany via Prisma), not one round-trip per metric point. This is the single highest-leverage scalability decision in the system, because metric volume dominates everything else by orders of magnitude.
Indexing matches the actual query patterns, not added speculatively: Metric(runId, key, step) for chart reads, Run(projectId) and Run(status) for list views, User(orgId) for team/auth lookups. Every index in the schema (§4) exists because a specific query in §6/§7 needs it — no index added "just in case."
Run list and metric reads use cursor-based pagination, not OFFSET/LIMIT — offset pagination degrades linearly with table size and this table grows unboundedly; cursor pagination (on createdAt/id) stays flat regardless of history size.
Chart rendering downsamples. A run with 100k logged steps never ships 100k points to the browser — the metrics-read endpoint accepts an optional max_points parameter and does LTTB-style or simple stride-based downsampling server-side, so chart payload size is bounded regardless of run length.
The Run.summary denormalized field exists specifically to keep the run-list view O(runs), not O(runs × metrics) — restated from §7.5, because it's a scalability decision as much as a UX one, and the two should never be allowed to drift apart in review (a PR that adds a new "at a glance" column to the run list without checking whether it needs a summary update is a bug, not a style nitpick).
No N+1 queries at the API layer — Prisma's include/select used deliberately per-route, reviewed as a checklist item (§10.4), not left to whatever the ORM defaults to.
Explicitly not built for v1, and why that's fine at this scale: read replicas, caching layer (Redis), background job queue, sharding. All of these solve problems that show up at 10–100x the stated target. Building them now would violate G5 (one-engineer maintainability) for no present benefit — each is a clearly scoped v2 addition if and when real usage data says it's needed, not a default.
10. Engineering Standards (OSS quality bar)
This project ships publicly under the SAGEA name. "Barebones in scope" does not mean "amateur in execution" — those are independent axes, and this section exists to keep them independent throughout the build, not just at final review.

10.1 DRY, applied concretely (not just as a slogan)
One HTTP client in the SDK (§8.2), one auth-guard function for role checks (§5.2), one Prisma client instance (singleton, never re-instantiated per request — a common Next.js/Prisma footgun that exhausts DB connections under load).
Shared Zod (or equivalent) schemas for request validation, reused between the API route handler and, where relevant, generated into SDK-side type hints — the request/response contract should be defined once and imported, not redefined by hand in two languages independently drifting apart. Where that's not practical across the Python/TypeScript boundary, the OpenAPI-style contract in §6 is the source of truth both sides are tested against (§10.2).
Shared UI primitives: a status-badge component, a metric-chart component, a role-guard wrapper component — each built once, used everywhere it's needed, not copy-pasted per page.
10.2 Testing — every feature ships with tests, no exceptions
Testing is not a milestone at the end; each milestone in §11 includes its own test deliverables, and "add tests" is never a separate follow-up ticket.

Layer	Tool	Coverage target
Web app — unit	Vitest	Pure functions: downsampling logic, auth-guard logic, summary-merging logic. Fast, no DB.
Web app — API routes	Vitest + a real Postgres test container (via testcontainers or a CI-provisioned throwaway DB)	Every route in §6, both success paths and authorization-failure paths (a member hitting a super-admin route must be tested to 403, not just assumed).
Web app — components	React Testing Library	Key interactive components: run table selection/compare flow, invite dialog, API key creation/reveal-once behavior.
Web app — E2E	Playwright	The critical user journeys end to end against a real running instance: login → create project → (via SDK, scripted) log a run → view it in the dashboard → compare two runs → invite a member → member logs in with restricted permissions.
SDK	Pytest	init/log/finish against a mocked HTTP layer (no real network in unit tests); batching/flush-timing logic; the non-blocking-on-network-failure guarantee (§8.1) is a named, explicit test case, not incidental.
SDK — integration	Pytest, opt-in marker	A smaller suite that runs against a real local server instance (spun up in CI via the Dockerfile) to catch drift between SDK expectations and actual server behavior — the thing unit tests with mocks can't catch.
CI (GitHub Actions) runs the full unit + component + API + SDK suite on every PR; E2E and SDK-integration suites run on every PR too but are allowed to be the slower gate — either way, nothing merges to main with a red check, full stop (restated from §1.4 as a hard process rule, not just a metric).
New code without a corresponding test is a review blocker, not a "nice to have" comment — this applies equally to the author (Basab included) and to outside contributors; the bar doesn't relax for OSS PRs, if anything it should be enforced more consistently since external contributors are the audience §10 exists for.
10.3 Clean code practices
TypeScript strict mode on (strict: true), no any without an explicit, commented justification.
Consistent formatting/linting enforced by tooling, not convention: ESLint + Prettier (web), ruff (Python SDK) — both run in CI as a required check, not just available locally.
Small, single-responsibility modules/functions over large ones; API route handlers should be thin (validate → call a service function → return), with actual business logic (role checks, summary merging, downsampling) living in separately unit-testable modules, not inlined in the route file.
Meaningful commit messages and PR descriptions — Conventional Commits recommended (feat:, fix:, chore:) since it's a low-cost convention that pays off immediately in an OSS project's changelog generation.
No commented-out dead code, no console.log/print debugging left in committed code (caught by lint rules where possible, by review otherwise).
10.4 CI/CD & review checklist
Automated (CI, blocking):

Lint (ESLint/Prettier, ruff)
Type-check (tsc --noEmit)
Full test suite (§10.2)
A dependency check that fails the build if lucide-react (or any non-shadcn UI library) appears in package.json — enforcing the icon/component constraints from §3.1 as code, not just as a PRD statement that can quietly drift.
Manual (PR review checklist, applied by whoever reviews — initially Basab, eventually community maintainers):

New route handlers checked against the DRY auth-guard pattern (§5.2/§10.1) — no inline role-check duplication.
New DB access checked for N+1 patterns (§9) and correct index usage.
New UI checked against the shadcn-only / react-icons-only constraints (§3.1).
Public API/SDK surface changes checked against §8.3 versioning rules.
10.5 Documentation as a first-class deliverable
Every exported SDK function has a docstring with a runnable example.
The README covers: what this is / isn't (honest, references §1.3 non-goals directly — see the comparable-projects note in §12), quickstart (self-host in under 10 minutes, per G3), architecture diagram (§3), and a CONTRIBUTING guide with the testing/lint requirements from this section spelled out so a first-time contributor isn't guessing at the bar.
11. Roadmap — Milestones
Each milestone is independently demoable and ships with its own tests (§10.2) — "write tests later" is not a milestone.

M0 — Spike & schema freeze (2–3 days)

Finalize DB schema (§4, Prisma schema) and API contract (§6) — treat these as frozen once M1 starts; changing them later means an SDK version bump (§8.3).
Confirm SDK PyPI package name (§8.5) and pin exact Next.js/Prisma/React versions (§3.1) in package.json.
Stand up the CI skeleton (lint, type-check, empty test suite passing) before any feature code lands — tests are infrastructure from commit one, not bolted on later.
Output: a design doc (this section formalized) + a CI-green empty scaffold, not feature code.
M1 — Ingestion path works end-to-end, no UI

Next.js API routes: create run, log metrics, finish run, heartbeat — with unit + API-level tests for each (§10.2).
Python SDK: init/log/finish against a local server, with the non-blocking-on-failure behavior explicitly tested.
Acceptance: a toy training loop logs 1000 points against a local server; rows are correctly batched and land in Postgres; the full M1 test suite is green in CI.
M2 — Auth, teams, and dashboard MVP

Session auth, org bootstrap (first super admin), invite flow (§5.3), role-gated team management routes (§6.2) — with authorization-failure test cases as a named requirement (§10.2), not an afterthought.
Dashboard: login, project list, run list, run detail with live-updating charts (poll every few seconds; no websockets in v1).
Acceptance: a SAGEA engineer can point a real training script at Cursus instead of W&B, and a super admin can invite a second team member who logs in with correctly restricted permissions. This is the "internally replaces W&B" milestone — G1 and G6 are both satisfied here.
M3 — Compare view + API key self-service + polish

Multi-run overlay charts, config diff view (§7.7).
Member-facing API key management UI (§7.9) — create/reveal-once/revoke, super-admin org-wide key view.
Downsampling implemented for high-step-count runs (§9) — this is the milestone where the scalability work actually lands in the UI, not deferred further.
M4 — Deployment hardening (OSS-readiness)

Dockerfile + docker-compose.yml (app + Postgres) that works with zero manual config beyond an .env, including automatic Prisma migration on first boot.
vercel.json / one-click Vercel deploy button in README pointing at a Vercel Postgres or Neon/Supabase instance.
Acceptance: the "cold start < 10 minutes" success metric, dry-run tested by someone outside the project (§1.4).
M5 — OSS launch prep

README with badges, quickstart, architecture diagram, honest comparison vs. W&B/MLflow/Aim (§12).
LICENSE (Apache 2.0 recommended for the patent grant — confirm against SAGEA's existing OSS licensing precedent if the SAGE model releases already set one).
CONTRIBUTING.md spelling out the §10 bar explicitly, issue templates, a good-first-issue batch.
Publish SDK to PyPI under the name resolved in §8.5.
Backlog (post-v1, explicitly not scheduled)

System metrics auto-capture (GPU util/mem via nvidia-smi polling in SDK)
Webhook/Slack alerting on run completion or failure
CSV/JSON export of metrics
Sweeps (grid/random/bayesian hyperparameter search coordination)
Multi-node distributed run aggregation
Fine-grained per-project permissions / custom roles beyond super admin / member
Transactional email for invites (currently manual link copy-paste, §5.3)
Redis caching layer, read replicas, job queue — only if real usage data crosses the scale target in §9
12. Risks
Risk	Mitigation
Metric ingestion volume outgrows the Postgres row-insert model	Documented as a known v2 concern (§3, §9); not a v1 blocker given SAGEA's actual scale target
SDK network issues disrupt training jobs	Non-blocking, fire-and-forget logging with bounded retries and a background thread (§8.1) — a hard requirement with an explicit test case (§10.2), not a nice-to-have
Scope creep toward "W&B clone" undermines the barebones goal and blows the one-engineer maintenance budget (G5)	Every feature request during OSS life gets checked against §1.3 Non-goals before being accepted; changing non-goals requires updating this doc, not just merging a PR
Self-host cold-start friction kills OSS adoption	M4 acceptance criterion is a real dry-run by someone unfamiliar with the repo, not just "it works on my machine"
Public OSS repo ships with a competitor's brand palette/trade dress	UI built in SAGEA's blue on dark, replicating W&B's UX patterns (density, layout, dark mode) but not its specific colors or logo (§7) — not a legal opinion, just a risk worth avoiding for free
Role-check logic duplicated ad hoc across routes creates a privilege-escalation bug	Centralized requireRole guard (§5.2), enforced as a PR-review checklist item (§10.4), tested explicitly for both roles on every gated route (§10.2)
Prisma 8's eventual stable release makes the v1 schema/tooling feel dated shortly after launch	Explicitly logged as a deliberate, revisit-later decision (§3.1) rather than a silent staleness — the README should state the pinned versions and the intent to track upgrades
13. Appendix — Comparable Projects (for README's honesty section)
Worth referencing in the eventual README so the project doesn't look naively unaware of prior art: Aim and MLflow both occupy similar territory (self-hostable, OSS experiment tracking). Cursus's differentiation is being smaller in scope than either — no autologging integrations, no model registry, a genuinely minimal two-role team model instead of a full permissions system — in exchange for a much smaller codebase and a deploy story (Vercel button or one Dockerfile) that neither of those makes a first-class citizen.