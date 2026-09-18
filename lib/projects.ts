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
  // One query + one batched include (not N+1): only the fields the cards
  // need. Counts/cards reflect VISIBLE runs only (group scoping applies).
  const projects = await db.project.findMany({
    where: { orgId, ...projectVisibilityFilter(session) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      slug: true,
      name: true,
      createdAt: true,
      group: { select: { slug: true, name: true } },
      runs: {
        where: runVisibilityFilter(session),
        select: { status: true, startedAt: true },
      },
    },
  });
  return projects
    .map((p) => {
      const statusCounts: Record<string, number> = {};
      let lastRunAt: Date | null = null;
      for (const r of p.runs) {
        statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
        if (!lastRunAt || r.startedAt > lastRunAt) lastRunAt = r.startedAt;
      }
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        group: p.group,
        runCount: p.runs.length,
        lastRunAt,
        statusCounts,
        createdAt: p.createdAt,
      };
    })
    .sort(
      (a, b) => (b.lastRunAt?.getTime() ?? 0) - (a.lastRunAt?.getTime() ?? 0),
    );
}

export async function createProject(
  session: Session | null,
  orgSlug: string,
  input: { name: string; slug?: string; group?: string },
): Promise<{ id: string; slug: string; name: string }> {
  requireAuth(session);
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
      group: { select: { slug: true, name: true } },
      // Stats aggregate VISIBLE runs only — a member must not infer hidden
      // runs from totals (counts, compute, contributors all scoped).
      runs: {
        where: runVisibilityFilter(session),
        select: {
          status: true,
          startedAt: true,
          finishedAt: true,
          createdBy: { select: { email: true, name: true } },
        },
      },
    },
  });
  if (!project) throw new ApiError(404, "project not found");
  const now = Date.now();
  const byUser = new Map<string, ProjectContributor>();
  const statusCounts: Record<string, number> = {};
  let lastActiveAt: Date | null = project.createdAt;
  let totalComputeMs = 0;
  for (const r of project.runs) {
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
    if (!lastActiveAt || r.startedAt > lastActiveAt) lastActiveAt = r.startedAt;
    totalComputeMs +=
      (r.finishedAt ?? new Date(now)).getTime() - r.startedAt.getTime();
    const key = r.createdBy.email;
    const entry = byUser.get(key) ?? {
      email: key,
      name: r.createdBy.name,
      runs: 0,
    };
    entry.runs += 1;
    // Name can change per row only if edited; last write wins, fine for v1.
    entry.name = r.createdBy.name;
    byUser.set(key, entry);
  }
  return {
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      createdAt: project.createdAt,
      group: project.group,
    },
    visibility: "Team",
    lastActiveAt,
    totalRuns: project.runs.length,
    totalComputeMs,
    contributors: [...byUser.values()].sort((a, b) => b.runs - a.runs),
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
  requireAuth(session);
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
