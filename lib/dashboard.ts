import { requireAuth, type Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectVisibilityFilter, runVisibilityFilter } from "@/lib/groups";
import { INVITE_PENDING_HASH } from "@/lib/password";

// Dashboard aggregates. Every number derives
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

export interface DashboardTopProject {
  slug: string;
  name: string;
  runs: number;
}

export interface DashboardStats {
  totalRuns: number;
  runningNow: number;
  projectCount: number;
  groupCount: number;
  memberCount: number;
  totalComputeMs: number;
  statusMix: { status: string; count: number }[];
  topProjects: DashboardTopProject[];
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
    memberCount,
    topProjectRows,
    totalComputeMs,
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
    isAdmin
      ? db.user.count({ where: { orgId: session.orgId } })
      : Promise.resolve(0),
    db.run.groupBy({
      by: ["projectId"],
      where: runScope,
      _count: { _all: true },
      orderBy: { _count: { projectId: "desc" } },
      take: 8,
    }),
    // Compute sum as a SQL aggregate (one row back, constant memory —
    // the old narrow-scan + JS sum grew with org run volume).
    getComputeMs(session),
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

  // Project names for the top-projects chart (lookup by id, still
  // org-scoped; flatMap drops ids that vanished mid-flight).
  const projectNames = new Map(
    (
      await db.project.findMany({
        where: {
          orgId: session.orgId,
          id: { in: topProjectRows.map((row) => row.projectId) },
        },
        select: { id: true, slug: true, name: true },
      })
    ).map((project) => [project.id, project] as const),
  );

  return {
    totalRuns,
    runningNow,
    projectCount,
    groupCount,
    memberCount,
    totalComputeMs,
    statusMix: statusRows.map((row) => ({
      status: row.status,
      count: row._count._all,
    })),
    topProjects: topProjectRows.flatMap((row) => {
      const project = projectNames.get(row.projectId);
      return project
        ? [{ slug: project.slug, name: project.name, runs: row._count._all }]
        : [];
    }),
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

/** Compute sum as one aggregate row (same visibility scope as the rest
 * of the dashboard). Unfinished runs bill to NOW(), matching the old
 * JS-side sum exactly. */
async function getComputeMs(session: Session): Promise<number> {
  const isAdmin = session.role === "SUPER_ADMIN";
  const rows = (await db.$queryRaw`
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (
      COALESCE(r."finishedAt", NOW()) - r."startedAt"
    ))), 0) AS ms
    FROM "Run" r
    JOIN "Project" p ON p.id = r."projectId"
    WHERE p."orgId" = ${session.orgId}
      AND (
        ${isAdmin} OR p."groupId" IS NULL OR EXISTS (
          SELECT 1 FROM group_members gm
          WHERE gm."groupId" = p."groupId" AND gm."userId" = ${session.userId}
        )
      )
  `) as { ms: number | string }[];
  return Number(rows[0]?.ms ?? 0) * 1000;
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
