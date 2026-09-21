import { db } from "@/lib/db";
import { downsample } from "@/lib/downsampling";
import {
  assertProjectActive,
  assertRunVisible,
  assertRunWritable,
  canWriteGroup,
  projectVisibilityFilter,
  resolveGroup,
  runVisibilityFilter,
  type GroupAuth,
} from "@/lib/groups";
import { mergeSummary } from "@/lib/summary";
import { slugify } from "@/lib/slug";
import type {
  BatchRunsInput,
  CreateRunInput,
  FinishRunInput,
  LogBatchInput,
  RunListSort,
  UpdateRunInput,
} from "@/lib/validation";
import { KeyAuthError } from "@/lib/api-auth";
import { requireRole, type Session } from "@/lib/auth";
import { ApiError } from "@/lib/http";

// Thin route handlers live in app/api (validate → auth → call service →
// return); everything testable lives here. No N+1: every read uses a single
// query with select/include. Every run read applies
// runVisibilityFilter (groups); every run write goes through the
// assertRunWritable gate.

export const API_VERSION = 1;

/**
 * Minutes of heartbeat/log silence after which a RUNNING run is declared
 * dead (stale-run detection). The SDK heartbeats every 30s independently
 * of training progress, so 15 minutes means 30 consecutive missed beats:
 * short pauses (GC, suspend, slow eval) can never trip it, while a killed
 * process surfaces within a quarter hour. No cron or job queue in v1 —
 * staleness is evaluated lazily on read (list/get), which is exactly when
 * the UI needs the answer.
 */
export const STALE_RUN_MINUTES = 15;

function staleCutoff(): Date {
  return new Date(Date.now() - STALE_RUN_MINUTES * 60_000);
}

/** Flip stale RUNNING runs in a project to CRASHED. Returns rows affected. */
export async function markStaleRuns(
  auth: { orgId: string },
  projectId: string,
): Promise<number> {
  const project = await db.project.findFirst({
    where: { id: projectId, orgId: auth.orgId },
    select: { id: true },
  });
  if (!project) throw new KeyAuthError(404, "project not found");
  const res = await db.run.updateMany({
    where: {
      projectId: project.id,
      status: "RUNNING",
      updatedAt: { lt: staleCutoff() },
    },
    // finishedAt approximates detection time; last sign of life is updatedAt.
    data: { status: "CRASHED", finishedAt: new Date() },
  });
  return res.count;
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export async function createRun(
  auth: GroupAuth & { userId: string },
  input: CreateRunInput,
): Promise<{ run_id: string; name: string; url: string }> {
  requireRole(auth, "MEMBER");
  // Optional group: the project is resolved or created INSIDE it (caller
  // must belong, admins bypass). A group-scoped project collects that
  // group's runs; runs inherit visibility from their project.
  let groupId: string | null = null;
  if (input.group !== undefined) {
    const group = await resolveGroup(auth.orgId, input.group);
    if (!(await canWriteGroup(auth, group.id))) {
      throw new ApiError(403, "not a member of this group");
    }
    groupId = group.id;
  }
  const slug = slugify(input.project) || "default";
  // Deliberate upsert-on-first-log: the fastest path to a first
  // project is calling init() from a script. Visibility-aware: a hidden
  // project never resolves (and a colliding hidden slug surfaces as the
  // same 404 as a missing one — no oracle either way).
  const visible = projectVisibilityFilter(auth);
  const existing = await db.project.findFirst({
    where: { orgId: auth.orgId, slug, ...visible },
    select: { id: true, slug: true, groupId: true },
  });
  let project: { id: string; slug: string; groupId: string | null };
  if (existing) {
    if (groupId !== null && existing.groupId !== groupId) {
      throw new ApiError(409, "project is not in this group");
    }
    project = existing;
  } else {
    try {
      project = await db.project.create({
        data: { orgId: auth.orgId, slug, name: input.project, groupId },
        select: { id: true, slug: true, groupId: true },
      });
    } catch (e) {
      if (
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code: string }).code === "P2002"
      ) {
        // Either lost a creation race (re-read and proceed) or the slug
        // belongs to a project hidden from the caller (same 404 as missing
        // — no oracle either way).
        const retry = await db.project.findFirst({
          where: { orgId: auth.orgId, slug, ...visible },
          select: { id: true, slug: true, groupId: true },
        });
        if (!retry) throw new ApiError(404, "project not found");
        project = retry;
      } else {
        throw e;
      }
    }
    if (groupId !== null && project.groupId !== groupId) {
      throw new ApiError(409, "project is not in this group");
    }
  }
  const name = input.name ?? `run-${shortId()}`;
  await assertProjectActive(project.id);
  if (input.sweep_id !== undefined) {
    const { assertSweepLinkable } = await import("@/lib/sweeps");
    await assertSweepLinkable(auth.orgId, project.id, input.sweep_id);
  }
  const run = await db.run.create({
    data: {
      projectId: project.id,
      sweepId: input.sweep_id ?? null,
      name,
      config: (input.config ?? {}) as object,
      tags: input.tags ?? [],
      createdById: auth.userId,
    },
    select: { id: true, name: true },
  });
  return {
    run_id: run.id,
    name: run.name,
    url: `/${project.slug}/runs/${run.id}`,
  };
}

async function assertRunInOrg(orgId: string, runId: string): Promise<string> {
  const run = await db.run.findFirst({
    where: { id: runId, project: { orgId } },
    select: { id: true },
  });
  if (!run) throw new KeyAuthError(404, "run not found");
  return run.id;
}

export async function logBatch(
  auth: GroupAuth,
  runId: string,
  input: LogBatchInput,
): Promise<{ logged: number }> {
  requireRole(auth, "MEMBER");
  await assertRunWritable(auth, runId);
  const rows = input.points.map((p) => ({
    runId,
    key: p.key,
    step: p.step,
    value: p.value,
    wallTime: p.wall_time ? new Date(p.wall_time) : new Date(),
  }));
  // Last value per key wins within the batch (filters non-finite junk).
  const patch = mergeSummary(
    {},
    input.points.map((p) => ({ key: p.key, value: p.value })),
  );
  // Single bulk insert per batch — never one round-trip per point —
  // plus an ATOMIC jsonb summary merge in the same transaction. A read-then-
  // write here would lose keys when two flushes for one run interleave
  // (timer + size triggers); `||` merges server-side with no read at all.
  await db.$transaction([
    db.metric.createMany({ data: rows }),
    db.$executeRaw`UPDATE "Run" SET "summary" = "summary" || ${JSON.stringify(patch)}::jsonb, "updatedAt" = NOW() WHERE "id" = ${runId}`,
  ]);
  return { logged: rows.length };
}

const FINISH_MAP = {
  finished: "FINISHED",
  crashed: "CRASHED",
  killed: "KILLED",
} as const;

export async function finishRun(
  auth: GroupAuth,
  runId: string,
  input: FinishRunInput,
): Promise<{ run_id: string; status: string }> {
  requireRole(auth, "MEMBER");
  await assertRunWritable(auth, runId);
  const finishedAt = new Date();
  const run = await db.run.update({
    where: { id: runId },
    data: {
      status: FINISH_MAP[input.status],
      finishedAt,
    },
    select: { id: true, status: true },
  });
  // Webhooks settle on their own: dispatch failures never fail the finish.
  // Awaited (not detached) so runtimes don't cut dispatch mid-flight; the
  // 5 s per-endpoint timeout bounds the delay, dead endpoints fail fast.
  try {
    const { notifyRunFinished } = await import("@/lib/webhooks");
    await notifyRunFinished(run.id, run.status, finishedAt);
  } catch {
    // Notification must never break finishes.
  }
  return { run_id: run.id, status: run.status };
}

export async function heartbeat(
  auth: GroupAuth,
  runId: string,
): Promise<{ run_id: string }> {
  requireRole(auth, "MEMBER");
  await assertRunWritable(auth, runId);
  await db.run.update({
    where: { id: runId },
    data: { updatedAt: new Date() },
  });
  return { run_id: runId };
}

export async function listRuns(
  auth: GroupAuth,
  projectSlug: string,
  opts: { cursor?: string; limit?: number; sort?: RunListSort } = {},
): Promise<{
  runs: Array<{
    id: string;
    name: string;
    status: string;
    tags: string[];
    notes: string;
    group: { slug: string; name: string } | null;
    summary: unknown;
    createdBy: string;
    startedAt: Date;
    finishedAt: Date | null;
  }>;
  nextCursor: string | null;
}> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const sort: RunListSort = opts.sort ?? "recent";
  const project = await db.project.findUnique({
    where: { orgId_slug: { orgId: auth.orgId, slug: projectSlug } },
    select: { id: true },
  });
  if (!project) throw new KeyAuthError(404, "project not found");
  // Dead-run sweep first, so the page below never shows a stale RUNNING.
  await markStaleRuns(auth, project.id);
  // Cursor-based pagination. The cursor filter must match the
  // ordering in every mode, otherwise rows repeat or vanish across pages.
  let cursorFilter = {};
  if (opts.cursor) {
    if (sort === "recent") {
      cursorFilter = { id: { lt: opts.cursor } };
    } else {
      const c = await db.run.findUnique({
        where: { id: opts.cursor },
        select: { id: true, name: true, startedAt: true },
      });
      if (!c) throw new ApiError(400, "invalid cursor");
      if (sort === "oldest") {
        cursorFilter = {
          OR: [
            { startedAt: { gt: c.startedAt } },
            { startedAt: c.startedAt, id: { gt: c.id } },
          ],
        };
      } else if (sort === "name_asc") {
        cursorFilter = {
          OR: [{ name: { gt: c.name } }, { name: c.name, id: { gt: c.id } }],
        };
      } else {
        cursorFilter = {
          OR: [{ name: { lt: c.name } }, { name: c.name, id: { lt: c.id } }],
        };
      }
    }
  }
  const orderBy =
    sort === "recent"
      ? [{ startedAt: "desc" as const }, { id: "desc" as const }]
      : sort === "oldest"
        ? [{ startedAt: "asc" as const }, { id: "asc" as const }]
        : sort === "name_asc"
          ? [{ name: "asc" as const }, { id: "asc" as const }]
          : [{ name: "desc" as const }, { id: "desc" as const }];
  const rows = await db.run.findMany({
    where: {
      projectId: project.id,
      ...runVisibilityFilter(auth),
      ...cursorFilter,
    },
    orderBy,
    take: limit + 1,
    select: {
      id: true,
      name: true,
      status: true,
      tags: true,
      notes: true,
      summary: true,
      startedAt: true,
      finishedAt: true,
      project: { select: { group: { select: { slug: true, name: true } } } },
      createdBy: { select: { email: true } },
    },
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    runs: page.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      tags: r.tags,
      notes: r.notes,
      group: r.project.group,
      summary: r.summary,
      createdBy: r.createdBy.email,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

export async function getMetrics(
  auth: GroupAuth,
  runId: string,
  opts: { key: string; maxPoints?: number; afterStep?: number },
): Promise<{ key: string; points: Array<{ step: number; value: number }> }> {
  await assertRunVisible(auth, runId);
  const rows = await db.metric.findMany({
    where: {
      runId,
      key: opts.key,
      ...(opts.afterStep !== undefined ? { step: { gt: opts.afterStep } } : {}),
    },
    orderBy: { step: "asc" },
    // Select step/value only — never ship the BigInt PK to JSON.
    select: { step: true, value: true },
  });
  const points = rows.map((r) => ({ step: r.step, value: r.value }));
  const maxPoints = opts.maxPoints ?? 2000;
  return { key: opts.key, points: downsample(points, maxPoints) };
}

export interface RunDetail {
  id: string;
  name: string;
  status: string;
  tags: string[];
  notes: string;
  config: unknown;
  summary: unknown;
  createdBy: string;
  startedAt: Date;
  finishedAt: Date | null;
  project: { id: string; slug: string; name: string };
  group: { slug: string; name: string } | null;
  keys: string[];
}

/** Single run + its metric keys for the detail/compare views. */
export async function getRun(
  auth: GroupAuth,
  runId: string,
): Promise<RunDetail> {
  const run = await db.run.findFirst({
    where: {
      id: runId,
      project: { orgId: auth.orgId },
      ...runVisibilityFilter(auth),
    },
    select: {
      id: true,
      name: true,
      status: true,
      tags: true,
      notes: true,
      config: true,
      summary: true,
      startedAt: true,
      updatedAt: true,
      finishedAt: true,
      project: {
        select: {
          id: true,
          slug: true,
          name: true,
          group: { select: { slug: true, name: true } },
        },
      },
      createdBy: { select: { email: true } },
    },
  });
  if (!run) throw new KeyAuthError(404, "run not found");
  // Same dead-run sweep as listRuns, scoped to this one run.
  let status = run.status;
  let finishedAt = run.finishedAt;
  if (run.status === "RUNNING" && run.updatedAt < staleCutoff()) {
    const flipped = await db.run.update({
      where: { id: run.id },
      data: { status: "CRASHED", finishedAt: new Date() },
      select: { status: true, finishedAt: true },
    });
    status = flipped.status;
    finishedAt = flipped.finishedAt;
  }
  const keyRows = await db.metric.groupBy({
    by: ["key"],
    where: { runId },
  });
  return {
    id: run.id,
    name: run.name,
    status,
    tags: run.tags,
    notes: run.notes,
    config: run.config,
    summary: run.summary,
    createdBy: run.createdBy.email,
    startedAt: run.startedAt,
    finishedAt,
    project: {
      id: run.project.id,
      slug: run.project.slug,
      name: run.project.name,
    },
    group: run.project.group,
    keys: keyRows.map((k) => k.key).sort(),
  };
}

/** Rename / retag / annotate a run. Write-gated on the run's project group. */
export async function updateRun(
  auth: GroupAuth,
  runId: string,
  input: UpdateRunInput,
): Promise<{ id: string; name: string; tags: string[]; notes: string }> {
  requireRole(auth, "MEMBER");
  await assertRunWritable(auth, runId);
  const run = await db.run.update({
    where: { id: runId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    select: { id: true, name: true, tags: true, notes: true },
  });
  return run;
}

/** Delete a run + its metrics (cascade). Super admin only (§5.1). */
export async function deleteRun(
  session: Session | null,
  runId: string,
): Promise<{ id: string }> {
  requireRole(session, "SUPER_ADMIN");
  await assertRunInOrg(session.orgId, runId);
  // Objects first: row delete cascades MediaItem metadata, which would
  // orphan the bytes. Storage failures never block the delete itself.
  try {
    const { purgeRunMedia } = await import("@/lib/media");
    await purgeRunMedia(runId);
  } catch {
    // Best-effort — orphaned objects share the deterministic key scheme
    // and are overwritten (never duplicated) by future logs.
  }
  await db.run.delete({ where: { id: runId } });
  return { id: runId };
}

/** Batch tag/delete over explicit ids (1–100). All-or-nothing: the runs
 * are resolved in ONE visibility-scoped query and the count must match,
 * so one hidden/foreign id fails the whole batch as 404 (no partial
 * writes, no oracle). Delete purges media objects before rows cascade
 * (metrics cascade, artifacts keep history via SetNull).
 */
export async function batchUpdateRuns(
  auth: GroupAuth,
  projectSlug: string,
  input: BatchRunsInput,
): Promise<{ affected: number }> {
  requireRole(auth, "MEMBER");
  const project = await db.project.findFirst({
    where: {
      orgId: auth.orgId,
      slug: projectSlug,
      ...projectVisibilityFilter(auth),
    },
    select: { id: true, groupId: true },
  });
  if (!project) throw new ApiError(404, "project not found");
  if (project.groupId && !(await canWriteGroup(auth, project.groupId))) {
    throw new ApiError(403, "not a member of this project's group");
  }
  const ids = [...new Set(input.ids)];
  const rows = await db.run.findMany({
    where: { id: { in: ids }, projectId: project.id },
    select: { id: true, tags: true },
  });
  if (rows.length !== ids.length) {
    throw new ApiError(404, "one or more runs not found");
  }
  if (input.op === "delete") {
    const media = await db.mediaItem.findMany({
      where: { runId: { in: ids } },
      select: { storageKey: true },
    });
    if (media.length > 0) {
      try {
        const { deleteObjects } = await import("@/lib/storage");
        await deleteObjects(media.map((m) => m.storageKey));
      } catch {
        // Best-effort — row deletes below still proceed.
      }
    }
    const deleted = await db.run.deleteMany({
      where: { id: { in: ids }, projectId: project.id },
    });
    return { affected: deleted.count };
  }
  const tags = input.tags ?? [];
  await db.$transaction(
    rows.map((row) =>
      db.run.update({
        where: { id: row.id },
        data: { tags: [...new Set([...row.tags, ...tags])].slice(0, 32) },
      }),
    ),
  );
  return { affected: rows.length };
}

export const RUN_CONFIG_MAX_KEYS = 100;
export const RUN_CONFIG_MAX_BYTES = 32 * 1024;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** Deep merge for config updates: plain objects recurse, everything else
 * (arrays, scalars) replaces. Last-write-wins, like the metrics summary. */
export function deepMergeConfig(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(next[key])) {
      next[key] = deepMergeConfig(next[key] as Record<string, unknown>, value);
    } else {
      next[key] = value;
    }
  }
  return next;
}

/** Mid-run config sync (SDK debounced updates). RUNNING only — finished
 * runs are history and 409. Caps hold the config column small: 100
 * top-level keys, 32 KB serialized.
 */
export async function updateRunConfig(
  auth: GroupAuth,
  runId: string,
  patch: Record<string, unknown>,
): Promise<{ id: string; config: unknown }> {
  requireRole(auth, "MEMBER");
  await assertRunWritable(auth, runId);
  const run = await db.run.findUnique({
    where: { id: runId },
    select: { id: true, status: true, config: true },
  });
  if (!run) throw new ApiError(404, "run not found");
  if (run.status !== "RUNNING") {
    throw new ApiError(409, "config is frozen once the run finishes");
  }
  const merged = deepMergeConfig(
    (run.config ?? {}) as Record<string, unknown>,
    patch,
  );
  if (Object.keys(merged).length > RUN_CONFIG_MAX_KEYS) {
    throw new ApiError(400, "config exceeds 100 top-level keys");
  }
  if (JSON.stringify(merged).length > RUN_CONFIG_MAX_BYTES) {
    throw new ApiError(400, "config exceeds 32 KB");
  }
  const updated = await db.run.update({
    where: { id: run.id },
    data: { config: merged as object },
    select: { id: true, config: true },
  });
  return { id: updated.id, config: updated.config };
}

export interface OverlaySeries {
  runId: string;
  name: string;
  points: { step: number; value: number }[];
}

/** Batched overlay series: one key across up to 10 runs in a single
 * response (one indexed range scan per run, downsampled server-side).
 * Every id must resolve to a visible run in this project or the whole
 * request 404s — no partial series, no hidden-row oracle. Bounded at
 * 10 runs × maxPoints (default 500) per response.
 */
export async function getOverlaySeries(
  auth: GroupAuth,
  projectSlug: string,
  key: string,
  runIds: string[],
  maxPoints: number,
): Promise<{ key: string; series: OverlaySeries[] }> {
  const project = await db.project.findFirst({
    where: {
      orgId: auth.orgId,
      slug: projectSlug,
      ...projectVisibilityFilter(auth),
    },
    select: { id: true },
  });
  if (!project) throw new ApiError(404, "project not found");
  const runs = await db.run.findMany({
    where: {
      id: { in: runIds },
      projectId: project.id,
      ...runVisibilityFilter(auth),
    },
    orderBy: { startedAt: "asc" },
    select: { id: true, name: true },
  });
  if (runs.length !== runIds.length) {
    throw new ApiError(404, "one or more runs not found");
  }
  const byId = new Map(runs.map((r) => [r.id, r]));
  const series = await Promise.all(
    runIds.map(async (id) => {
      const rows = await db.metric.findMany({
        where: { runId: id, key },
        orderBy: { step: "asc" },
        select: { step: true, value: true },
      });
      return {
        runId: id,
        name: byId.get(id)!.name,
        points: downsample(
          rows.map((r) => ({ step: r.step, value: r.value })),
          maxPoints,
        ),
      };
    }),
  );
  return { key, series };
}
