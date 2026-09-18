import { requireAuth, requireRole, type Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/http";
import { slugify } from "@/lib/slug";

// Groups: named org subsets with member-scoped run visibility. This file
// owns the ONE visibility rule the whole app shares (PRD non-goal amended
// deliberately: per-group scoping, nothing finer — no custom roles, no
// per-project ACLs, admins bypass everything).

export interface GroupAuth {
  orgId: string;
  userId: string;
  role: Session["role"];
}

/**
 * Prisma Run where-clause fragment: which runs may this caller see?
 * - SUPER_ADMIN: everything.
 * - MEMBER: org-wide runs (groupId NULL) + runs in their groups.
 * Missing AND hidden rows are indistinguishable (both 404) — no oracle.
 */
export function runVisibilityFilter(auth: GroupAuth) {
  if (auth.role === "SUPER_ADMIN") return {};
  return {
    OR: [
      { groupId: null },
      { group: { members: { some: { userId: auth.userId } } } },
    ],
  };
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
 * Write gate: same as visible, plus group members-only for grouped runs
 * (admins bypass). Org-wide runs stay writable by every member.
 */
export async function assertRunWritable(
  auth: GroupAuth,
  runId: string,
): Promise<{ id: string }> {
  const run = await db.run.findFirst({
    where: { id: runId, project: { orgId: auth.orgId } },
    select: { id: true, groupId: true },
  });
  if (!run) throw new ApiError(404, "run not found");
  if (run.groupId && !(await canWriteGroup(auth, run.groupId))) {
    throw new ApiError(403, "not a member of this run's group");
  }
  return run;
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
  runCount: number;
  createdAt: Date;
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
      _count: { select: { members: true, runs: true } },
    },
  });
  return groups.map((g) => ({
    id: g.id,
    slug: g.slug,
    name: g.name,
    description: g.description,
    memberCount: g._count.members,
    runCount: g._count.runs,
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
    return { ...group, memberCount: 0, runCount: 0 };
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
      _count: { select: { runs: true } },
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
    runCount: group._count.runs,
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
      _count: { select: { members: true, runs: true } },
    },
  });
  return {
    ...updated,
    memberCount: updated._count.members,
    runCount: updated._count.runs,
  };
}

/**
 * Delete a group: member links vanish (cascade), runs are UNGROUPED to
 * org-wide (SetNull) — never deleted. History survives; only the boundary
 * dissolves.
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

export interface GroupRunRow {
  id: string;
  name: string;
  status: string;
  projectSlug: string;
  createdBy: string;
  startedAt: Date;
}

/** Runs in a group, newest first. Caller must see the group (checked by
 * getGroup in the page, or membership inline here for API use). */
export async function listGroupRuns(
  auth: GroupAuth,
  slug: string,
): Promise<GroupRunRow[]> {
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
  const runs = await db.run.findMany({
    where: { groupId: group.id },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: 200,
    select: {
      id: true,
      name: true,
      status: true,
      startedAt: true,
      createdBy: { select: { email: true } },
      project: { select: { slug: true } },
    },
  });
  return runs.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    projectSlug: r.project.slug,
    createdBy: r.createdBy.email,
    startedAt: r.startedAt,
  }));
}
