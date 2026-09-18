import { AuthError, requireAuth, type Session } from "@/lib/auth";
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
