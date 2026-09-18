import { db } from "@/lib/db";
import { downsample } from "@/lib/downsampling";
import {
  assertRunVisible,
  assertRunWritable,
  canWriteGroup,
  resolveGroup,
  runVisibilityFilter,
  type GroupAuth,
} from "@/lib/groups";
import { mergeSummary } from "@/lib/summary";
import { slugify } from "@/lib/slug";
import type {
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
// query with select/include (PRD §9). Every run read applies
// runVisibilityFilter (groups); every run write goes through the
// assertRunWritable gate.

export const API_VERSION = 1;

/**
 * Minutes of heartbeat/log silence after which a RUNNING run is declared
 * dead (PRD dead-run detection). The SDK heartbeats every 30s independently
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
  const slug = slugify(input.project) || "default";
  const project = await db.project.upsert({
    where: { orgId_slug: { orgId: auth.orgId, slug } },
    update: {},
    // Deliberate upsert-on-first-log (PRD §7.2): the fastest path to a first
    // project is calling init() from a script — you rarely "create a project"
    // as a standalone action, mirroring how W&B works.
    create: { orgId: auth.orgId, slug, name: input.project },
    select: { id: true, slug: true },
  });
  // Group-scoped runs: the group must exist and the caller must belong to it
  // (admins bypass). A non-member logging into someone's group is a 403.
  let groupId: string | null = null;
  if (input.group !== undefined) {
    const group = await resolveGroup(auth.orgId, input.group);
    if (!(await canWriteGroup(auth, group.id))) {
      throw new ApiError(403, "not a member of this group");
    }
    groupId = group.id;
  }
  const name = input.name ?? `run-${shortId()}`;
  const run = await db.run.create({
    data: {
      projectId: project.id,
      name,
      config: (input.config ?? {}) as object,
      tags: input.tags ?? [],
      groupId,
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
  // Single bulk insert per batch (PRD §9) — never one round-trip per point —
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
  await assertRunWritable(auth, runId);
  const run = await db.run.update({
    where: { id: runId },
    data: {
      status: FINISH_MAP[input.status],
      finishedAt: new Date(),
    },
    select: { id: true, status: true },
  });
  return { run_id: run.id, status: run.status };
}

export async function heartbeat(
  auth: GroupAuth,
  runId: string,
): Promise<{ run_id: string }> {
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
  // Cursor-based pagination (PRD §9). The cursor filter must match the
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
      group: { select: { slug: true, name: true } },
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
      group: r.group,
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
    // Select step/value only — never ship the BigInt PK to JSON (PRD §4).
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
      group: { select: { slug: true, name: true } },
      createdBy: { select: { email: true } },
      project: { select: { id: true, slug: true, name: true } },
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
    project: run.project,
    group: run.group,
    keys: keyRows.map((k) => k.key).sort(),
  };
}

/**
 * Rename / retag / annotate / regroup a run. The caller must satisfy the
 * write rule for the run's CURRENT group, and — when moving groups — for
 * the TARGET group too (null target = org-wide, always allowed).
 */
export async function updateRun(
  auth: GroupAuth,
  runId: string,
  input: UpdateRunInput,
): Promise<{
  id: string;
  name: string;
  tags: string[];
  notes: string;
  group: { slug: string; name: string } | null;
}> {
  const current = await db.run.findFirst({
    where: { id: runId, project: { orgId: auth.orgId } },
    select: { id: true, groupId: true },
  });
  if (!current) throw new ApiError(404, "run not found");
  if (current.groupId && !(await canWriteGroup(auth, current.groupId))) {
    throw new ApiError(403, "not a member of this run's group");
  }
  let groupId: string | null | undefined;
  if (input.group !== undefined) {
    if (input.group === null) {
      groupId = null;
    } else {
      const target = await resolveGroup(auth.orgId, input.group);
      if (!(await canWriteGroup(auth, target.id))) {
        throw new ApiError(403, "not a member of the target group");
      }
      groupId = target.id;
    }
  }
  const run = await db.run.update({
    where: { id: runId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(groupId !== undefined ? { groupId } : {}),
    },
    select: {
      id: true,
      name: true,
      tags: true,
      notes: true,
      group: { select: { slug: true, name: true } },
    },
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
  await db.run.delete({ where: { id: runId } });
  return { id: runId };
}
