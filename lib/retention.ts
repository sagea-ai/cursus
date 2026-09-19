import { requireRole, type Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/http";

// Retention: per-project metric TTL + archival + on-demand purge. No cron
// or job queue in v1 — purging is an explicit admin action (dry-run first).
// Purge deletes Metric rows only; runs, summaries, media, and artifacts
// survive (charts show the gap honestly).

export const PURGE_BATCH_SIZE = 10_000;
export const MAX_TTL_DAYS = 3650;

export interface RetentionInfo {
  metricsTtlDays: number | null;
  archivedAt: Date | null;
}

async function assertAdminProject(
  session: Session | null,
  orgSlug: string,
  projectSlug: string,
): Promise<{ id: string }> {
  requireRole(session, "SUPER_ADMIN");
  const org = await db.org.findUnique({
    where: { slug: orgSlug },
    select: { id: true },
  });
  if (!org || org.id !== session.orgId) {
    throw new ApiError(404, "project not found");
  }
  const project = await db.project.findUnique({
    where: { orgId_slug: { orgId: org.id, slug: projectSlug } },
    select: { id: true },
  });
  if (!project) throw new ApiError(404, "project not found");
  return project;
}

export async function setProjectRetention(
  session: Session | null,
  orgSlug: string,
  projectSlug: string,
  metricsTtlDays: number | null,
): Promise<RetentionInfo> {
  const project = await assertAdminProject(session, orgSlug, projectSlug);
  if (
    metricsTtlDays !== null &&
    (!Number.isInteger(metricsTtlDays) ||
      metricsTtlDays < 1 ||
      metricsTtlDays > MAX_TTL_DAYS)
  ) {
    throw new ApiError(400, "TTL must be 1–3650 days or null");
  }
  const updated = await db.project.update({
    where: { id: project.id },
    data: { metricsTtlDays },
    select: { metricsTtlDays: true, archivedAt: true },
  });
  return updated;
}

export async function setProjectArchived(
  session: Session | null,
  orgSlug: string,
  projectSlug: string,
  archived: boolean,
): Promise<RetentionInfo> {
  const project = await assertAdminProject(session, orgSlug, projectSlug);
  const updated = await db.project.update({
    where: { id: project.id },
    data: { archivedAt: archived ? new Date() : null },
    select: { metricsTtlDays: true, archivedAt: true },
  });
  return updated;
}

export async function purgeProjectMetrics(
  session: Session | null,
  orgSlug: string,
  projectSlug: string,
  dryRun: boolean,
): Promise<{ deleted: number; dryRun: boolean; cutoff: string }> {
  const project = await assertAdminProject(session, orgSlug, projectSlug);
  const row = await db.project.findUniqueOrThrow({
    where: { id: project.id },
    select: { metricsTtlDays: true },
  });
  if (!row.metricsTtlDays) {
    throw new ApiError(400, "set a metrics TTL before purging");
  }
  const cutoff = new Date(Date.now() - row.metricsTtlDays * 86_400_000);
  const where = {
    wallTime: { lt: cutoff },
    run: { projectId: project.id },
  };
  if (dryRun) {
    return {
      deleted: await db.metric.count({ where }),
      dryRun,
      cutoff: cutoff.toISOString(),
    };
  }
  // Batched BigInt-PK deletes: no statement timeouts, no memory growth.
  let deleted = 0;
  for (;;) {
    const batch = await db.metric.findMany({
      where,
      orderBy: { id: "asc" },
      take: PURGE_BATCH_SIZE,
      select: { id: true },
    });
    if (batch.length === 0) break;
    const res = await db.metric.deleteMany({
      where: { id: { in: batch.map((m) => m.id) } },
    });
    deleted += res.count;
    if (batch.length < PURGE_BATCH_SIZE) break;
  }
  return { deleted, dryRun, cutoff: cutoff.toISOString() };
}
