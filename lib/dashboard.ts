import { requireAuth, type Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectVisibilityFilter, runVisibilityFilter } from "@/lib/groups";
import { INVITE_PENDING_HASH } from "@/lib/password";

// Dashboard aggregates (docs/prd-dashboard.md §6). Every number derives
// from bounded aggregate queries — groupBy/count/sum-shaped reads, one
// capped list — never from loading run rows. Visibility scoping applies to
// all counts: a member must not infer hidden runs from dashboard totals.

export interface DashboardRecentRun {
  id: string;
  name: string;
  status: string;
  projectSlug: string;
  projectName: string;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface DashboardCrashedRun {
  id: string;
  name: string;
  projectSlug: string;
  finishedAt: Date | null;
}

export interface DashboardStats {
  totalRuns: number;
  runningNow: number;
  projectCount: number;
  groupCount: number;
  totalComputeMs: number;
  activity: { date: string; count: number }[];
  recentRuns: DashboardRecentRun[];
  crashedWeek: DashboardCrashedRun[];
  pendingInvites: number;
}

export async function getDashboardStats(
  session: Session | null,
): Promise<DashboardStats> {
  requireAuth(session);
  const isAdmin = session.role === "SUPER_ADMIN";
  const runScope = {
    project: { orgId: session.orgId },
    ...runVisibilityFilter(session),
  };
  const [
    statusRows,
    projectCount,
    groupCount,
    spans,
    activity,
    recentRuns,
    crashedWeek,
    pendingInvites,
  ] = await Promise.all([
    db.run.groupBy({
      by: ["status"],
      where: runScope,
      _count: { _all: true },
    }),
    db.project.count({
      where: { orgId: session.orgId, ...projectVisibilityFilter(session) },
    }),
    db.group.count({
      where: isAdmin
        ? { orgId: session.orgId }
        : {
            orgId: session.orgId,
            members: { some: { userId: session.userId } },
          },
    }),
    // Narrow durations scan for the compute sum (two date columns, no
    // joins, no text). Bounded by org run volume at the stated scale;
    // graduate to a raw SUM aggregate if it ever shows in traces.
    db.run.findMany({
      where: runScope,
      select: { startedAt: true, finishedAt: true },
    }),
    getActivitySeries(session),
    db.run.findMany({
      where: runScope,
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: 8,
      select: {
        id: true,
        name: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        project: { select: { slug: true, name: true } },
      },
    }),
    db.run.findMany({
      where: {
        ...runScope,
        status: "CRASHED",
        finishedAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
      },
      orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
      take: 8,
      select: {
        id: true,
        name: true,
        finishedAt: true,
        project: { select: { slug: true } },
      },
    }),
    isAdmin
      ? db.user.count({
          where: { orgId: session.orgId, passwordHash: INVITE_PENDING_HASH },
        })
      : Promise.resolve(0),
  ]);

  let totalRuns = 0;
  let runningNow = 0;
  for (const row of statusRows) {
    totalRuns += row._count._all;
    if (row.status === "RUNNING") runningNow = row._count._all;
  }
  const now = Date.now();
  let totalComputeMs = 0;
  for (const r of spans) {
    totalComputeMs +=
      (r.finishedAt ?? new Date(now)).getTime() - r.startedAt.getTime();
  }

  return {
    totalRuns,
    runningNow,
    projectCount,
    groupCount,
    totalComputeMs,
    activity,
    recentRuns: recentRuns.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      projectSlug: r.project.slug,
      projectName: r.project.name,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
    })),
    crashedWeek: crashedWeek.map((r) => ({
      id: r.id,
      name: r.name,
      projectSlug: r.project.slug,
      finishedAt: r.finishedAt,
    })),
    pendingInvites,
  };
}

async function getActivitySeries(
  session: Session,
): Promise<{ date: string; count: number }[]> {
  const days = 30;
  const isAdmin = session.role === "SUPER_ADMIN";
  const rows = (await db.$queryRaw`
    SELECT DATE(r."startedAt") AS day, COUNT(*)::int AS n
    FROM "Run" r
    JOIN "Project" p ON p.id = r."projectId"
    WHERE p."orgId" = ${session.orgId}
      AND r."startedAt" >= NOW() - (${days}::int * INTERVAL '1 day')
      AND (
        ${isAdmin} OR p."groupId" IS NULL OR EXISTS (
          SELECT 1 FROM group_members gm
          WHERE gm."groupId" = p."groupId" AND gm."userId" = ${session.userId}
        )
      )
    GROUP BY 1
  `) as { day: Date; n: number }[];
  const byDay = new Map(
    rows.map((r) => [r.day.toISOString().slice(0, 10), r.n]),
  );
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const out: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(today.getTime() - i * 86_400_000)
      .toISOString()
      .slice(0, 10);
    out.push({ date: key, count: byDay.get(key) ?? 0 });
  }
  return out;
}
