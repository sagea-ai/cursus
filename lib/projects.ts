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
