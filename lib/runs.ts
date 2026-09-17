import { db } from "@/lib/db";
import { downsample } from "@/lib/downsampling";
import { mergeSummary } from "@/lib/summary";
import type {
  CreateRunInput,
  FinishRunInput,
  LogBatchInput,
} from "@/lib/validation";
import { KeyAuthError } from "@/lib/api-auth";

// Business logic for ingestion routes. Route handlers stay thin
// (validate → auth → call service → return); everything testable lives here.
// No N+1: every read uses a single query with select/include (PRD §9).

export const API_VERSION = 1;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 128);
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export async function createRun(
  auth: { orgId: string; userId: string },
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
  const name = input.name ?? `run-${shortId()}`;
  const run = await db.run.create({
    data: {
      projectId: project.id,
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
  auth: { orgId: string },
  runId: string,
  input: LogBatchInput,
): Promise<{ logged: number }> {
  await assertRunInOrg(auth.orgId, runId);
  const rows = input.points.map((p) => ({
    runId,
    key: p.key,
    step: p.step,
    value: p.value,
    wallTime: p.wall_time ? new Date(p.wall_time) : new Date(),
  }));
  // Single bulk insert per batch (PRD §9) — never one round-trip per point.
  await db.metric.createMany({ data: rows });
  const run = await db.run.findUnique({
    where: { id: runId },
    select: { summary: true },
  });
  const summary = mergeSummary(
    (run?.summary ?? {}) as Record<string, number>,
    input.points.map((p) => ({ key: p.key, value: p.value })),
  );
  await db.run.update({
    where: { id: runId },
    data: { summary: summary as object, updatedAt: new Date() },
  });
  return { logged: rows.length };
}

const FINISH_MAP = {
  finished: "FINISHED",
  crashed: "CRASHED",
  killed: "KILLED",
} as const;

export async function finishRun(
  auth: { orgId: string },
  runId: string,
  input: FinishRunInput,
): Promise<{ run_id: string; status: string }> {
  await assertRunInOrg(auth.orgId, runId);
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
  auth: { orgId: string },
  runId: string,
): Promise<{ run_id: string }> {
  await assertRunInOrg(auth.orgId, runId);
  await db.run.update({
    where: { id: runId },
    data: { updatedAt: new Date() },
  });
  return { run_id: runId };
}

export async function listRuns(
  auth: { orgId: string },
  projectSlug: string,
  opts: { cursor?: string; limit?: number } = {},
): Promise<{
  runs: Array<{
    id: string;
    name: string;
    status: string;
    tags: string[];
    summary: unknown;
    createdBy: string;
    startedAt: Date;
    finishedAt: Date | null;
  }>;
  nextCursor: string | null;
}> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const project = await db.project.findUnique({
    where: { orgId_slug: { orgId: auth.orgId, slug: projectSlug } },
    select: { id: true },
  });
  if (!project) throw new KeyAuthError(404, "project not found");
  // Cursor-based pagination on (startedAt, id) — stays flat as history grows;
  // OFFSET/LIMIT degrades linearly on this unbounded table (PRD §9).
  const rows = await db.run.findMany({
    where: {
      projectId: project.id,
      ...(opts.cursor ? { id: { lt: opts.cursor } } : {}),
    },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      name: true,
      status: true,
      tags: true,
      summary: true,
      startedAt: true,
      finishedAt: true,
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
      summary: r.summary,
      createdBy: r.createdBy.email,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

export async function getMetrics(
  auth: { orgId: string },
  runId: string,
  opts: { key: string; maxPoints?: number; afterStep?: number },
): Promise<{ key: string; points: Array<{ step: number; value: number }> }> {
  await assertRunInOrg(auth.orgId, runId);
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
