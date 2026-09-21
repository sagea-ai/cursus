import { requireAuth, requireRole, type Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/http";
import { slugify } from "@/lib/slug";

// Groups: named org subsets that own projects. Runs inherit their project's
// visibility — there is no per-run scope. One rule shared by the whole app
// (amended non-goal, kept minimal: member-or-open reads, no custom roles,
// no per-project ACLs, admins bypass everything).

export interface GroupAuth {
  orgId: string;
  userId: string;
  role: Session["role"];
}

/**
 * Prisma Run where-clause fragment: which runs may this caller see?
 * Visibility is inherited from the project: org-wide projects (groupId
 * NULL) are open to every member; grouped projects only to group members
 * (and super admins). Missing AND hidden rows are indistinguishable (both
 * 404) — no oracle.
 */
export function runVisibilityFilter(auth: GroupAuth) {
  if (auth.role === "SUPER_ADMIN") return {};
  return {
    OR: [
      { project: { groupId: null } },
      { project: { group: { members: { some: { userId: auth.userId } } } } },
    ],
  };
}

/** Same rule for Project where-clauses. */
export function projectVisibilityFilter(auth: GroupAuth) {
  if (auth.role === "SUPER_ADMIN") return {};
  return {
    OR: [
      { groupId: null },
      { group: { members: { some: { userId: auth.userId } } } },
    ],
  };
}

/** Archived projects are read-only: content writes 409 until unarchived.
 * Call after resolving the project in every content-write path (runs,
 * media via assertRunWritable, artifacts, sweeps, webhooks). Metadata
 * writes (rename, TTL, archive itself) stay allowed. */
export async function assertProjectActive(projectId: string): Promise<void> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { archivedAt: true },
  });
  if (project?.archivedAt) {
    throw new ApiError(409, "project is archived — unarchive to write");
  }
}

/** True when the caller may LOG to this group (member of it, or admin). */
export async function canWriteGroup(
  auth: GroupAuth,
  groupId: string,
): Promise<boolean> {
  if (auth.role === "SUPER_ADMIN") return true;
  const membership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: auth.userId } },
    select: { groupId: true },
  });
  return membership !== null;
}

/** Resolve a group slug within the caller's org (404 if missing). */
export async function resolveGroup(
  orgId: string,
  slug: string,
): Promise<{ id: string; slug: string; name: string }> {
  const group = await db.group.findUnique({
    where: { orgId_slug: { orgId, slug: slugify(slug) || slug } },
    select: { id: true, slug: true, name: true },
  });
  if (!group) throw new ApiError(404, "group not found");
  return group;
}

/**
 * Read gate: the run must exist in-org AND be visible to the caller.
 * Hidden and missing are the same 404 (no oracle).
 */
export async function assertRunVisible(
  auth: GroupAuth,
  runId: string,
): Promise<{ id: string }> {
  const run = await db.run.findFirst({
    where: {
      id: runId,
      project: { orgId: auth.orgId },
      ...runVisibilityFilter(auth),
    },
    select: { id: true },
  });
  if (!run) throw new ApiError(404, "run not found");
  return run;
}

/**
 * Write gate: same as visible, plus group members-only for runs in grouped
 * projects (admins bypass). Org-wide project runs stay writable by every
 * member.
 */
export async function assertRunWritable(
  auth: GroupAuth,
  runId: string,
): Promise<{ id: string }> {
  const run = await db.run.findFirst({
    where: { id: runId, project: { orgId: auth.orgId } },
    select: {
      id: true,
      project: { select: { groupId: true, archivedAt: true } },
    },
  });
  if (!run) throw new ApiError(404, "run not found");
  if (run.project.archivedAt) {
    throw new ApiError(409, "project is archived — unarchive to write");
  }
  if (
    run.project.groupId &&
    !(await canWriteGroup(auth, run.project.groupId))
  ) {
    throw new ApiError(403, "not a member of this run's group");
  }
  return run;
}

/**
 * Project gate for member-level operations (rename, artifacts, overview):
 * the project must exist in-org AND be visible. Admins bypass.
 */
export async function assertProjectVisible(
  auth: GroupAuth,
  orgId: string,
  slug: string,
): Promise<{ id: string }> {
  const project = await db.project.findFirst({
    where: {
      orgId,
      slug,
      ...projectVisibilityFilter(auth),
    },
    select: { id: true },
  });
  if (!project) throw new ApiError(404, "project not found");
  return project;
}

async function groupInOrg(orgId: string, slug: string) {
  const group = await db.group.findUnique({
    where: { orgId_slug: { orgId, slug } },
  });
  if (!group) throw new ApiError(404, "group not found");
  return group;
}

export interface GroupSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  memberCount: number;
  projectCount: number;
  runCount: number;
  createdAt: Date;
}

async function countGroupRuns(groupId: string): Promise<number> {
  return db.run.count({ where: { project: { groupId } } });
}

/** Groups visible to the caller: all for admins, member-groups for members. */
export async function listGroups(
  session: Session | null,
): Promise<GroupSummary[]> {
  requireAuth(session);
  const groups = await db.group.findMany({
    where:
      session.role === "SUPER_ADMIN"
        ? { orgId: session.orgId }
        : {
            orgId: session.orgId,
            members: { some: { userId: session.userId } },
          },
    orderBy: { name: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      createdAt: true,
      projects: { select: { id: true } },
      _count: { select: { members: true, projects: true } },
    },
  });
  // Run counts in ONE grouped query (not one count per group): group
  // runs by project, then fold projects into their groups in JS.
  const runsByProject = new Map<string, number>();
  const projectIds = groups.flatMap((g) => g.projects.map((p) => p.id));
  if (projectIds.length > 0) {
    const runCounts = await db.run.groupBy({
      by: ["projectId"],
      where: { projectId: { in: projectIds } },
      _count: { _all: true },
    });
    for (const r of runCounts) runsByProject.set(r.projectId, r._count._all);
  }
  return groups.map((g) => ({
    id: g.id,
    slug: g.slug,
    name: g.name,
    description: g.description,
    memberCount: g._count.members,
    projectCount: g._count.projects,
    runCount: g.projects.reduce(
      (sum, p) => sum + (runsByProject.get(p.id) ?? 0),
      0,
    ),
    createdAt: g.createdAt,
  }));
}

export async function createGroup(
  session: Session | null,
  input: { name: string; slug?: string; description?: string },
): Promise<GroupSummary> {
  requireRole(session, "SUPER_ADMIN");
  const slug = slugify(input.slug ?? input.name);
  if (!slug) throw new ApiError(400, "could not derive a slug from the name");
  try {
    const group = await db.group.create({
      data: {
        orgId: session.orgId,
        slug,
        name: input.name,
        description: input.description ?? "",
        createdById: session.userId,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        createdAt: true,
      },
    });
    return { ...group, memberCount: 0, projectCount: 0, runCount: 0 };
  } catch (e) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "P2002"
    ) {
      throw new ApiError(409, "group slug already exists");
    }
    throw e;
  }
}

export interface GroupDetail extends GroupSummary {
  members: { id: string; email: string; name: string }[];
}

export async function getGroup(
  session: Session | null,
  slug: string,
): Promise<GroupDetail> {
  requireAuth(session);
  const group = await db.group.findUnique({
    where: { orgId_slug: { orgId: session.orgId, slug } },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      createdAt: true,
      members: {
        orderBy: { addedAt: "asc" },
        select: { user: { select: { id: true, email: true, name: true } } },
      },
      _count: { select: { projects: true } },
    },
  });
  if (!group) throw new ApiError(404, "group not found");
  // Members see only their own groups; the slug existing must not leak.
  if (
    session.role !== "SUPER_ADMIN" &&
    !group.members.some((m) => m.user.id === session.userId)
  ) {
    throw new ApiError(404, "group not found");
  }
  return {
    id: group.id,
    slug: group.slug,
    name: group.name,
    description: group.description,
    memberCount: group.members.length,
    projectCount: group._count.projects,
    runCount: await countGroupRuns(group.id),
    createdAt: group.createdAt,
    members: group.members.map((m) => m.user),
  };
}

export async function updateGroup(
  session: Session | null,
  slug: string,
  input: { name?: string; description?: string },
): Promise<GroupSummary> {
  requireRole(session, "SUPER_ADMIN");
  const group = await groupInOrg(session.orgId, slug);
  const updated = await db.group.update({
    where: { id: group.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
    },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      createdAt: true,
      _count: { select: { members: true, projects: true } },
    },
  });
  return {
    ...updated,
    memberCount: updated._count.members,
    projectCount: updated._count.projects,
    runCount: await countGroupRuns(updated.id),
  };
}

/**
 * Delete a group: member links vanish (cascade), projects UNGROUP to
 * org-wide (SetNull) — nothing is ever deleted but the boundary itself.
 */
export async function deleteGroup(
  session: Session | null,
  slug: string,
): Promise<{ slug: string }> {
  requireRole(session, "SUPER_ADMIN");
  const group = await groupInOrg(session.orgId, slug);
  await db.group.delete({ where: { id: group.id } });
  return { slug };
}

export async function addGroupMember(
  session: Session | null,
  slug: string,
  email: string,
): Promise<{ id: string; email: string; name: string }> {
  requireRole(session, "SUPER_ADMIN");
  const group = await groupInOrg(session.orgId, slug);
  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.orgId !== session.orgId) {
    throw new ApiError(404, "user not found in this org");
  }
  try {
    await db.groupMember.create({
      data: { groupId: group.id, userId: user.id },
    });
  } catch (e) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "P2002"
    ) {
      throw new ApiError(409, "already a member");
    }
    throw e;
  }
  return { id: user.id, email: user.email, name: user.name };
}

export async function removeGroupMember(
  session: Session | null,
  slug: string,
  targetUserId: string,
): Promise<{ id: string }> {
  requireRole(session, "SUPER_ADMIN");
  const group = await groupInOrg(session.orgId, slug);
  try {
    await db.groupMember.delete({
      where: { groupId_userId: { groupId: group.id, userId: targetUserId } },
    });
  } catch (e) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "P2025"
    ) {
      throw new ApiError(404, "membership not found");
    }
    throw e;
  }
  return { id: targetUserId };
}

export interface GroupProjectRow {
  id: string;
  slug: string;
  name: string;
  runCount: number;
  lastActiveAt: Date | null;
}

/** Projects in a group (caller must see the group — same 404 rule). */
export async function listGroupProjects(
  auth: GroupAuth,
  slug: string,
): Promise<GroupProjectRow[]> {
  const group = await db.group.findUnique({
    where: { orgId_slug: { orgId: auth.orgId, slug } },
    select: { id: true },
  });
  if (!group) throw new ApiError(404, "group not found");
  if (auth.role !== "SUPER_ADMIN") {
    const membership = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId: group.id, userId: auth.userId } },
      select: { groupId: true },
    });
    if (!membership) throw new ApiError(404, "group not found");
  }
  const projects = await db.project.findMany({
    where: { groupId: group.id },
    orderBy: { name: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      runs: { select: { startedAt: true } },
    },
  });
  return projects.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    runCount: p.runs.length,
    lastActiveAt:
      p.runs.length === 0
        ? null
        : p.runs.reduce(
            (m, r) => (r.startedAt > m ? r.startedAt : m),
            p.runs[0]!.startedAt,
          ),
  }));
}
