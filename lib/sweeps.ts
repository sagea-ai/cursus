import { requireAuth, type Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { canWriteGroup, projectVisibilityFilter } from "@/lib/groups";
import { ApiError } from "@/lib/http";
import type { CreateSweepInput, SweepSpace } from "@/lib/validation";

// Minimal sweeps: grid + random over a declared space, worker-pull trials.
// Grid claims are optimistic-locked on the cursor (read → conditional
// increment with bounded retries), so concurrent workers never double-issue
// a cell. Random is stateless. Bayesian is explicitly out.

export const SWEEP_MAX_DIMS = 8;
export const SWEEP_MAX_GRID_CELLS = 10_000;
export const SWEEP_MAX_VALUES = 50;

export interface SweepSummary {
  id: string;
  name: string;
  method: string;
  state: string;
  runCount: number;
  createdBy: string;
  createdAt: Date;
}

export interface SweepDetail extends SweepSummary {
  space: SweepSpace;
  projectSlug: string;
}

async function assertSweepVisible(
  auth: Session,
  sweepId: string,
): Promise<{
  id: string;
  projectId: string;
  method: string;
  state: string;
  space: SweepSpace;
  cursor: number;
}> {
  const sweep = await db.sweep.findFirst({
    where: {
      id: sweepId,
      project: { orgId: auth.orgId, ...projectVisibilityFilter(auth) },
    },
    select: {
      id: true,
      projectId: true,
      method: true,
      state: true,
      space: true,
      cursor: true,
    },
  });
  if (!sweep) throw new ApiError(404, "sweep not found");
  return { ...sweep, space: sweep.space as unknown as SweepSpace };
}

function validateSpace(
  method: "GRID" | "RANDOM",
  space: SweepSpace,
): {
  dims: [
    string,
    number[] | { min: number; max: number; scale: "linear" | "log" },
  ][];
  gridCells: number;
} {
  const entries = Object.entries(space);
  if (entries.length === 0 || entries.length > SWEEP_MAX_DIMS) {
    throw new ApiError(400, "sweep needs 1–8 dimensions");
  }
  let gridCells = 1;
  const dims = entries.map(([name, dim]) => {
    if ("values" in dim) {
      if (dim.values.length < 2 || dim.values.length > SWEEP_MAX_VALUES) {
        throw new ApiError(400, `dimension ${name} needs 2–50 values`);
      }
      gridCells *= dim.values.length;
      return [name, dim.values] as [string, number[]];
    }
    if (method === "GRID") {
      throw new ApiError(400, `grid sweeps need values[] for ${name}`);
    }
    if (!(dim.max > dim.min)) {
      throw new ApiError(400, `dimension ${name} needs max > min`);
    }
    return [
      name,
      { min: dim.min, max: dim.max, scale: dim.scale ?? "linear" },
    ] as [string, { min: number; max: number; scale: "linear" | "log" }];
  });
  if (method === "GRID" && gridCells > SWEEP_MAX_GRID_CELLS) {
    throw new ApiError(400, "grid exceeds 10k combinations");
  }
  return { dims, gridCells };
}

function gridCombo(
  dims: [string, number[]][],
  index: number,
): Record<string, string | number | boolean> {
  const config: Record<string, string | number | boolean> = {};
  let rest = index;
  for (let i = dims.length - 1; i >= 0; i--) {
    const [name, values] = dims[i]!;
    config[name] = values[rest % values.length]!;
    rest = Math.floor(rest / values.length);
  }
  return config;
}

function randomSample(
  dims: [
    string,
    number[] | { min: number; max: number; scale: "linear" | "log" },
  ][],
): Record<string, string | number | boolean> {
  const config: Record<string, string | number | boolean> = {};
  for (const [name, dim] of dims) {
    if (Array.isArray(dim)) {
      config[name] = dim[Math.floor(Math.random() * dim.length)]!;
    } else if (dim.scale === "log") {
      const lo = Math.log(dim.min);
      config[name] = Math.exp(lo + Math.random() * (Math.log(dim.max) - lo));
    } else {
      config[name] = dim.min + Math.random() * (dim.max - dim.min);
    }
  }
  return config;
}

export async function createSweep(
  session: Session | null,
  projectSlug: string,
  input: CreateSweepInput,
): Promise<SweepDetail> {
  requireAuth(session);
  // Projects resolve-or-create like runs (SDK-first flow): org-wide, no
  // group — group placement happens on the project, not the sweep.
  const slug = projectSlug.trim();
  if (!slug) throw new ApiError(400, "project is required");
  const visible = projectVisibilityFilter(session);
  let project = await db.project.findFirst({
    where: { orgId: session.orgId, slug, ...visible },
    select: { id: true, groupId: true },
  });
  if (!project) {
    try {
      project = await db.project.create({
        data: { orgId: session.orgId, slug, name: projectSlug },
        select: { id: true, groupId: true },
      });
    } catch (e) {
      if (
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code: string }).code === "P2002"
      ) {
        const retry = await db.project.findFirst({
          where: { orgId: session.orgId, slug, ...visible },
          select: { id: true, groupId: true },
        });
        if (!retry) throw new ApiError(404, "project not found");
        project = retry;
      } else {
        throw e;
      }
    }
  }
  if (project.groupId && !(await canWriteGroup(session, project.groupId))) {
    throw new ApiError(403, "not a member of this project's group");
  }
  validateSpace(input.method, input.space);
  const created = await db.sweep.create({
    data: {
      projectId: project.id,
      name: input.name,
      method: input.method,
      space: input.space as object,
      createdById: session.userId,
    },
    select: {
      id: true,
      name: true,
      method: true,
      state: true,
      space: true,
      cursor: true,
      createdBy: { select: { email: true } },
      createdAt: true,
      _count: { select: { runs: true } },
    },
  });
  return toDetail(created, projectSlug);
}

export async function listSweeps(
  session: Session | null,
  projectSlug: string,
): Promise<SweepSummary[]> {
  requireAuth(session);
  const project = await db.project.findFirst({
    where: {
      orgId: session.orgId,
      slug: projectSlug,
      ...projectVisibilityFilter(session),
    },
    select: { id: true },
  });
  if (!project) throw new ApiError(404, "project not found");
  const rows = await db.sweep.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      method: true,
      state: true,
      createdBy: { select: { email: true } },
      createdAt: true,
      _count: { select: { runs: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    method: r.method,
    state: r.state,
    runCount: r._count.runs,
    createdBy: r.createdBy.email,
    createdAt: r.createdAt,
  }));
}

export async function getSweep(
  session: Session | null,
  sweepId: string,
): Promise<SweepDetail> {
  requireAuth(session);
  const sweep = await db.sweep.findFirst({
    where: {
      id: sweepId,
      project: { orgId: session.orgId, ...projectVisibilityFilter(session) },
    },
    select: {
      id: true,
      name: true,
      method: true,
      state: true,
      space: true,
      cursor: true,
      createdBy: { select: { email: true } },
      createdAt: true,
      project: { select: { slug: true } },
      _count: { select: { runs: true } },
    },
  });
  if (!sweep) throw new ApiError(404, "sweep not found");
  return toDetail(sweep, sweep.project.slug);
}

export interface SweepTrial {
  trial: number;
  config: Record<string, string | number | boolean>;
  sweep_id: string;
}

/** Worker pull: claim the next config. 409 when the sweep isn't RUNNING
 * or the grid is exhausted (clean loop exit — not an error). */
export async function nextTrial(
  session: Session | null,
  sweepId: string,
): Promise<SweepTrial | null> {
  requireAuth(session);
  const sweep = await assertSweepVisible(session, sweepId);
  if (sweep.state !== "RUNNING") return null;
  const { dims, gridCells } = validateSpace(
    sweep.method as "GRID" | "RANDOM",
    sweep.space,
  );
  if (sweep.method === "RANDOM") {
    return {
      trial: sweep.cursor,
      config: randomSample(dims),
      sweep_id: sweep.id,
    };
  }
  // Grid: optimistic-lock the cursor so concurrent workers never share a
  // cell. Bounded retries; exhaustion returns null instead of erroring.
  for (let attempt = 0; attempt < 10; attempt++) {
    const current = await db.sweep.findUnique({
      where: { id: sweep.id },
      select: { cursor: true, state: true },
    });
    if (
      !current ||
      current.state !== "RUNNING" ||
      current.cursor >= gridCells
    ) {
      return null;
    }
    const claimed = await db.sweep.updateMany({
      where: { id: sweep.id, cursor: current.cursor, state: "RUNNING" },
      data: { cursor: current.cursor + 1 },
    });
    if (claimed.count === 1) {
      return {
        trial: current.cursor,
        config: gridCombo(dims as [string, number[]][], current.cursor),
        sweep_id: sweep.id,
      };
    }
  }
  return null;
}

export async function setSweepState(
  session: Session | null,
  sweepId: string,
  state: "FINISHED" | "CANCELLED",
): Promise<SweepDetail> {
  requireAuth(session);
  const sweep = await assertSweepVisible(session, sweepId);
  const project = await db.project.findUniqueOrThrow({
    where: { id: sweep.projectId },
    select: { slug: true, groupId: true },
  });
  // State changes are writes: same gate as creation.
  if (
    project.groupId &&
    session.role !== "SUPER_ADMIN" &&
    !(await canWriteGroup(session, project.groupId))
  ) {
    throw new ApiError(403, "not a member of this project's group");
  }
  const updated = await db.sweep.update({
    where: { id: sweep.id },
    data: { state },
    select: {
      id: true,
      name: true,
      method: true,
      state: true,
      space: true,
      cursor: true,
      createdBy: { select: { email: true } },
      createdAt: true,
      _count: { select: { runs: true } },
    },
  });
  return toDetail(updated, project.slug);
}

/** Sweep member runs for the detail page (capped, indexed, visible-only —
 * the sweep itself is already visibility-gated). */
export async function listSweepRuns(
  session: Session | null,
  sweepId: string,
): Promise<
  {
    id: string;
    name: string;
    status: string;
    startedAt: Date;
    summary: unknown;
  }[]
> {
  requireAuth(session);
  const sweep = await assertSweepVisible(session, sweepId);
  return db.run.findMany({
    where: { sweepId: sweep.id },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      id: true,
      name: true,
      status: true,
      startedAt: true,
      summary: true,
    },
  });
}

/** Validate a sweep link at run creation: same project, still RUNNING. */
export async function assertSweepLinkable(
  orgId: string,
  projectId: string,
  sweepId: string,
): Promise<void> {
  const sweep = await db.sweep.findFirst({
    where: { id: sweepId, project: { id: projectId, orgId } },
    select: { id: true, state: true },
  });
  if (!sweep) throw new ApiError(400, "sweep not found in this project");
  if (sweep.state !== "RUNNING") {
    throw new ApiError(409, "sweep is no longer running");
  }
}

function toDetail(
  sweep: {
    id: string;
    name: string;
    method: string;
    state: string;
    space: unknown;
    createdBy: { email: string };
    createdAt: Date;
    _count: { runs: number };
  },
  projectSlug: string,
): SweepDetail {
  return {
    id: sweep.id,
    name: sweep.name,
    method: sweep.method,
    state: sweep.state,
    runCount: sweep._count.runs,
    createdBy: sweep.createdBy.email,
    createdAt: sweep.createdAt,
    space: sweep.space as unknown as SweepSpace,
    projectSlug,
  };
}
