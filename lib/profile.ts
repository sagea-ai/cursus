import { AuthError, requireAuth, type Session } from "@/lib/auth";
import { computeStreaks, type Streaks } from "@/lib/activity";
import { db } from "@/lib/db";
import { runVisibilityFilter } from "@/lib/groups";
import type { UpdateProfileInput } from "@/lib/validation";

// Own-profile service. Email and name are immutable by construction: the
// validation schema has no such fields (zod strips them if sent), so there
// is no code path that writes them here. Every read below is bounded and
// indexed: one row for the profile, one grouped aggregate for activity,
// one capped, indexed author query for runs. No N+1 anywhere.

export interface ProfileInfo {
  id: string;
  email: string;
  name: string;
  bio: string;
  location: string;
  website: string;
  twitter: string;
  github: string;
  role: Session["role"];
  createdAt: Date;
  org: { id: string; slug: string; name: string };
}

export async function getProfile(
  session: Session | null,
): Promise<ProfileInfo> {
  requireAuth(session);
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      name: true,
      bio: true,
      location: true,
      website: true,
      twitter: true,
      github: true,
      role: true,
      createdAt: true,
      org: { select: { id: true, slug: true, name: true } },
    },
  });
  if (!user) throw new AuthError(401, "authentication required");
  return user;
}

export async function updateProfile(
  session: Session | null,
  input: UpdateProfileInput,
): Promise<ProfileInfo> {
  requireAuth(session);
  const updated = await db.user.update({
    where: { id: session.userId },
    data: {
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
      ...(input.website !== undefined ? { website: input.website } : {}),
      ...(input.twitter !== undefined
        ? { twitter: input.twitter.replace(/^@+/, "") }
        : {}),
      ...(input.github !== undefined
        ? { github: input.github.replace(/^@+/, "") }
        : {}),
    },
    select: {
      id: true,
      email: true,
      name: true,
      bio: true,
      location: true,
      website: true,
      twitter: true,
      github: true,
      role: true,
      createdAt: true,
      org: { select: { id: true, slug: true, name: true } },
    },
  });
  return updated;
}

export interface ActivityDay {
  /** YYYY-MM-DD in UTC. */
  date: string;
  count: number;
}

export async function getActivity(
  session: Session | null,
  days = 365,
): Promise<{ total: number; days: ActivityDay[] }> {
  requireAuth(session);
  const span = Math.min(Math.max(days, 7), 366);
  // One grouped aggregate over the indexed (createdById, startedAt) path.
  // DATE() truncates to UTC days; only the caller's own runs count — and
  // only ones still visible to them (a run in a group you left stops
  // coloring your heatmap, same as the runs list; admins bypass).
  const isAdmin = session.role === "SUPER_ADMIN";
  const rows = (
    isAdmin
      ? await db.$queryRaw`
          SELECT DATE("startedAt") AS day, COUNT(*)::int AS n
          FROM "Run"
          WHERE "createdById" = ${session.userId}
            AND "startedAt" >= NOW() - (${span}::int * INTERVAL '1 day')
          GROUP BY 1
        `
      : await db.$queryRaw`
          SELECT DATE(r."startedAt") AS day, COUNT(*)::int AS n
          FROM "Run" r
          JOIN "Project" p ON p.id = r."projectId"
          WHERE r."createdById" = ${session.userId}
            AND r."startedAt" >= NOW() - (${span}::int * INTERVAL '1 day')
            AND (
              p."groupId" IS NULL OR EXISTS (
                SELECT 1 FROM group_members gm
                WHERE gm."groupId" = p."groupId" AND gm."userId" = ${session.userId}
              )
            )
          GROUP BY 1
        `
  ) as { day: Date; n: number }[];
  const byDay = new Map(
    rows.map((r) => [r.day.toISOString().slice(0, 10), r.n]),
  );
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const result: ActivityDay[] = [];
  let total = 0;
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const count = byDay.get(key) ?? 0;
    total += count;
    result.push({ date: key, count });
  }
  return { total, days: result };
}

export interface ProfileRunRow {
  id: string;
  name: string;
  status: string;
  projectSlug: string;
  projectName: string;
  startedAt: Date;
  finishedAt: Date | null;
}

export async function listProfileRuns(
  session: Session | null,
  opts: { q?: string; limit?: number } = {},
): Promise<ProfileRunRow[]> {
  requireAuth(session);
  // Own runs AND visible to the caller (a run in a group you left stays
  // hidden — the visibility rule has no author exception, by design).
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const q = opts.q?.trim();
  const rows = await db.run.findMany({
    where: {
      createdById: session.userId,
      ...runVisibilityFilter(session),
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      name: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      project: { select: { slug: true, name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    projectSlug: r.project.slug,
    projectName: r.project.name,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  }));
}

export interface ActivityTopProject {
  slug: string;
  name: string;
  runs: number;
}

export interface ActivityOverview {
  totalRuns: number;
  weekRuns: number;
  /** Org-wide visible runs (no author filter) — for "share of org" context. */
  orgRuns: number;
  totalComputeMs: number;
  longestRunMs: number;
  pointsLogged: number;
  crashed: number;
  streaks: Streaks;
  statusMix: { status: string; count: number }[];
  topProjects: ActivityTopProject[];
  activity: ActivityDay[];
  recentRuns: ProfileRunRow[];
}

function spanMs(startedAt: Date, finishedAt: Date | null): number {
  return Math.max(
    0,
    (finishedAt ?? new Date()).getTime() - startedAt.getTime(),
  );
}

/** Everything the "Your activity" page needs. Same scoping as the profile
 * reads (own runs, still visible to the caller), same bounded-query budget
 * as the dashboard: one year aggregate (reused), one capped recents list
 * (reused), two groupBys, one narrow durations scan, one name lookup, and
 * two single-row counts (org context, points volume). */
export async function getActivityOverview(
  session: Session | null,
): Promise<ActivityOverview> {
  requireAuth(session);
  const scope = {
    createdById: session.userId,
    ...runVisibilityFilter(session),
  };
  // Org context + points volume: two bounded single-row counts. Metric
  // count nests the run filter (author + visibility) under the relation.
  const orgScope = {
    project: { orgId: session.orgId },
    ...runVisibilityFilter(session),
  };
  const [
    activity,
    recentRuns,
    statusRows,
    topProjectRows,
    spans,
    orgRuns,
    pointsLogged,
  ] = await Promise.all([
    getActivity(session, 365),
    listProfileRuns(session, { limit: 8 }),
    db.run.groupBy({
      by: ["status"],
      where: scope,
      _count: { _all: true },
    }),
    db.run.groupBy({
      by: ["projectId"],
      where: scope,
      _count: { _all: true },
      orderBy: { _count: { projectId: "desc" } },
      take: 6,
    }),
    db.run.findMany({
      where: scope,
      select: { startedAt: true, finishedAt: true },
    }),
    db.run.count({ where: orgScope }),
    db.metric.count({
      where: { run: { ...scope, project: { orgId: session.orgId } } },
    }),
  ]);

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

  const totalRuns = statusRows.reduce((sum, row) => sum + row._count._all, 0);
  const durations = spans.map((span) =>
    spanMs(span.startedAt, span.finishedAt),
  );
  return {
    totalRuns,
    weekRuns: activity.days.slice(-7).reduce((sum, d) => sum + d.count, 0),
    orgRuns,
    totalComputeMs: durations.reduce((sum, ms) => sum + ms, 0),
    longestRunMs: durations.length > 0 ? Math.max(...durations) : 0,
    pointsLogged,
    crashed:
      statusRows.find((row) => row.status === "CRASHED")?._count._all ?? 0,
    streaks: computeStreaks(activity.days),
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
    activity: activity.days,
    recentRuns,
  };
}
