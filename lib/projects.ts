import { requireAuth, requireRole, type Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/http";
import {
  assertProjectVisible,
  canWriteGroup,
  projectVisibilityFilter,
  resolveGroup,
  runVisibilityFilter,
} from "@/lib/groups";
import { slugify } from "@/lib/slug";

// Project listing/creation for the dashboard (session auth). SDK run creation
// upserts projects implicitly via POST /runs — this is the explicit path.
//
// Visibility: org-wide projects (groupId NULL) are open to every member;
// grouped projects only to group members (and super admins). Hidden projects
// 404 everywhere — the list, stats, rename, and delete paths all enforce it.

export interface ProjectSummary {
  id: string;
  slug: string;
  name: string;
  group: { slug: string; name: string } | null;
  runCount: number;
  lastRunAt: Date | null;
  statusCounts: Record<string, number>;
  createdAt: Date;
}

async function orgIdFor(session: Session, orgSlug: string): Promise<string> {
  const org = await db.org.findUnique({
    where: { slug: orgSlug },
    select: { id: true },
  });
  if (!org || org.id !== session.orgId)
    throw new ApiError(404, "org not found");
  return org.id;
}

export async function listProjects(
  session: Session | null,
  orgSlug: string,
): Promise<ProjectSummary[]> {
  requireAuth(session);
  const orgId = await orgIdFor(session, orgSlug);
  // Bounded to TWO queries no matter how many runs exist: the project rows,
  // then one grouped aggregation. The old shape (include every run row)
  // grew linearly with training volume — exactly the table this avoids.
  const projects = await db.project.findMany({
    where: { orgId, ...projectVisibilityFilter(session) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      slug: true,
      name: true,
      createdAt: true,
      group: { select: { slug: true, name: true } },
    },
  });
  if (projects.length === 0) return [];
  const stats = await db.run.groupBy({
    by: ["projectId", "status"],
    where: { projectId: { in: projects.map((p) => p.id) } },
    _count: { _all: true },
    _max: { startedAt: true },
  });
  const byProject = new Map<
    string,
    { counts: Record<string, number>; lastRunAt: Date | null }
  >();
  for (const row of stats) {
    let entry = byProject.get(row.projectId);
    if (!entry) {
      entry = { counts: {}, lastRunAt: null };
      byProject.set(row.projectId, entry);
    }
    entry.counts[row.status] = row._count._all;
    const started = row._max.startedAt;
    if (started && (!entry.lastRunAt || started > entry.lastRunAt)) {
      entry.lastRunAt = started;
    }
  }
  const runCountOf = (id: string) =>
    Object.values(byProject.get(id)?.counts ?? {}).reduce((a, b) => a + b, 0);
  return projects
    .map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      group: p.group,
      runCount: runCountOf(p.id),
      lastRunAt: byProject.get(p.id)?.lastRunAt ?? null,
      statusCounts: byProject.get(p.id)?.counts ?? {},
      createdAt: p.createdAt,
    }))
    .sort(
      (a, b) => (b.lastRunAt?.getTime() ?? 0) - (a.lastRunAt?.getTime() ?? 0),
    );
}

export async function createProject(
  session: Session | null,
  orgSlug: string,
  input: { name: string; slug?: string; group?: string },
): Promise<{ id: string; slug: string; name: string }> {
  requireRole(session, "MEMBER");
  const orgId = await orgIdFor(session, orgSlug);
  const slug = slugify(input.slug ?? input.name);
  if (!slug) throw new ApiError(400, "could not derive a slug from the name");
  // Group placement: members may create inside their own groups, admins
  // anywhere; omitted means org-wide public. Checked BEFORE the insert so a
  // stranger can never plant a project in someone's group.
  let groupId: string | null = null;
  if (input.group !== undefined) {
    const group = await resolveGroup(orgId, input.group);
    if (!(await canWriteGroup(session, group.id))) {
      throw new ApiError(403, "not a member of this group");
    }
    groupId = group.id;
  }
  try {
    const project = await db.project.create({
      data: { orgId, slug, name: input.name, groupId },
      select: { id: true, slug: true, name: true },
    });
    return project;
  } catch (e) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "P2002"
    ) {
      throw new ApiError(409, "project slug already exists");
    }
    throw e;
  }
}

/** Delete a project + its runs + metrics (cascade). Super admin only. */
export async function deleteProject(
  session: Session | null,
  orgSlug: string,
  projectSlug: string,
): Promise<{ slug: string }> {
  requireRole(session, "SUPER_ADMIN");
  const orgId = await orgIdFor(session, orgSlug);
  const project = await assertProjectVisible(
    { orgId, userId: session.userId, role: session.role },
    orgId,
    projectSlug,
  );
  await db.project.delete({ where: { id: project.id } });
  return { slug: projectSlug };
}

export interface ProjectContributor {
  email: string;
  name: string;
  runs: number;
}

export interface ProjectOverview {
  project: {
    id: string;
    slug: string;
    name: string;
    createdAt: Date;
    group: { slug: string; name: string } | null;
    metricsTtlDays: number | null;
    archivedAt: Date | null;
  };
  /** v1 has no per-project visibility: everything is org-visible. */
  visibility: "Team";
  lastActiveAt: Date | null;
  totalRuns: number;
  /** Sum of (finishedAt ?? now) - startedAt across runs, in milliseconds. */
  totalComputeMs: number;
  contributors: ProjectContributor[];
  statusCounts: Record<string, number>;
}

/** Everything the project overview page needs in two queries, no N+1. */
export async function getProjectOverview(
  session: Session | null,
  orgSlug: string,
  projectSlug: string,
): Promise<ProjectOverview> {
  requireAuth(session);
  const orgId = await orgIdFor(session, orgSlug);
  const { id: projectId } = await assertProjectVisible(
    { orgId, userId: session.userId, role: session.role },
    orgId,
    projectSlug,
  );
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      slug: true,
      name: true,
      createdAt: true,
      metricsTtlDays: true,
      archivedAt: true,
      group: { select: { slug: true, name: true } },
    },
  });
  // Unreachable unless the row vanishes between the two queries above.
  if (!project) throw new ApiError(404, "project not found");
  // Aggregates, not row loads: status mix + recency in one grouped query,
  // contributors in another, and only narrow (startedAt, finishedAt) pairs
  // for the compute sum. Cost is O(distinct users), never O(runs × columns).
  // (If compute ever needs to avoid even the narrow scan, fold it into a
  // single SUM(COALESCE(finishedAt, NOW()) - startedAt) raw query.)
  const where = { projectId, ...runVisibilityFilter(session) };
  const [statusRows, recency, contributorRows, spans] = await Promise.all([
    db.run.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
    db.run.aggregate({ where, _max: { startedAt: true } }),
    db.run.groupBy({
      by: ["createdById"],
      where,
      _count: { _all: true },
    }),
    db.run.findMany({
      where,
      select: { startedAt: true, finishedAt: true },
    }),
  ]);
  const statusCounts: Record<string, number> = {};
  let totalRuns = 0;
  for (const row of statusRows) {
    statusCounts[row.status] = row._count._all;
    totalRuns += row._count._all;
  }
  const contributors: ProjectContributor[] =
    contributorRows.length === 0
      ? []
      : (
          await db.user.findMany({
            where: { id: { in: contributorRows.map((r) => r.createdById) } },
            select: { id: true, email: true, name: true },
          })
        ).map((u) => ({
          email: u.email,
          name: u.name,
          runs:
            contributorRows.find((r) => r.createdById === u.id)?._count._all ??
            0,
        }));
  contributors.sort((a, b) => b.runs - a.runs);
  const now = Date.now();
  let totalComputeMs = 0;
  for (const r of spans) {
    totalComputeMs +=
      (r.finishedAt ?? new Date(now)).getTime() - r.startedAt.getTime();
  }
  return {
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      createdAt: project.createdAt,
      group: project.group,
      metricsTtlDays: project.metricsTtlDays,
      archivedAt: project.archivedAt,
    },
    visibility: "Team",
    lastActiveAt: recency._max.startedAt,
    totalRuns,
    totalComputeMs,
    contributors,
    statusCounts,
  };
}

/**
 * Rename and/or move a project (slug is stable). Any member may rename a
 * project they can see; moving between groups is super-admin-only
 * (group = null moves it back to org-wide public).
 */
export async function updateProject(
  session: Session | null,
  orgSlug: string,
  projectSlug: string,
  input: { name?: string; group?: string | null },
): Promise<{
  id: string;
  slug: string;
  name: string;
  group: { slug: string; name: string } | null;
}> {
  requireRole(session, "MEMBER");
  const orgId = await orgIdFor(session, orgSlug);
  const { id: projectId } = await assertProjectVisible(
    { orgId, userId: session.userId, role: session.role },
    orgId,
    projectSlug,
  );
  let groupId: string | null | undefined;
  if (input.group !== undefined) {
    requireRole(session, "SUPER_ADMIN");
    if (input.group === null) {
      groupId = null;
    } else {
      groupId = (await resolveGroup(orgId, input.group)).id;
    }
  }
  try {
    return await db.project.update({
      where: { id: projectId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(groupId !== undefined ? { groupId } : {}),
      },
      select: {
        id: true,
        slug: true,
        name: true,
        group: { select: { slug: true, name: true } },
      },
    });
  } catch (e) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "P2025"
    ) {
      throw new ApiError(404, "project not found");
    }
    throw e;
  }
}
