import { requireAuth, requireRole, type Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/http";
import { slugify } from "@/lib/runs";

// Project listing/creation for the dashboard (session auth). SDK run creation
// upserts projects implicitly via POST /runs — this is the explicit path.

export interface ProjectSummary {
  id: string;
  slug: string;
  name: string;
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
  // One query + one batched include (not N+1): only the fields the cards need.
  const projects = await db.project.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      slug: true,
      name: true,
      createdAt: true,
      runs: { select: { status: true, startedAt: true } },
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
  input: { name: string; slug?: string },
): Promise<{ id: string; slug: string; name: string }> {
  requireAuth(session);
  const orgId = await orgIdFor(session, orgSlug);
  const slug = slugify(input.slug ?? input.name);
  if (!slug) throw new ApiError(400, "could not derive a slug from the name");
  try {
    const project = await db.project.create({
      data: { orgId, slug, name: input.name },
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
  const project = await db.project.findUnique({
    where: { orgId_slug: { orgId, slug: projectSlug } },
    select: { id: true },
  });
  if (!project) throw new ApiError(404, "project not found");
  await db.project.delete({ where: { id: project.id } });
  return { slug: projectSlug };
}

export interface ProjectContributor {
  email: string;
  name: string;
  runs: number;
}

export interface ProjectOverview {
  project: { id: string; slug: string; name: string; createdAt: Date };
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
  const project = await db.project.findUnique({
    where: { orgId_slug: { orgId, slug: projectSlug } },
    select: {
      id: true,
      slug: true,
      name: true,
      createdAt: true,
      runs: {
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
    },
    visibility: "Team",
    lastActiveAt,
    totalRuns: project.runs.length,
    totalComputeMs,
    contributors: [...byUser.values()].sort((a, b) => b.runs - a.runs),
    statusCounts,
  };
}

/** Rename a project (slug is stable). Any org member. */
export async function renameProject(
  session: Session | null,
  orgSlug: string,
  projectSlug: string,
  name: string,
): Promise<{ id: string; slug: string; name: string }> {
  requireAuth(session);
  const orgId = await orgIdFor(session, orgSlug);
  try {
    return await db.project.update({
      where: { orgId_slug: { orgId, slug: projectSlug } },
      data: { name },
      select: { id: true, slug: true, name: true },
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
