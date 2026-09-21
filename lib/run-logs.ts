import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  assertRunWritable,
  runVisibilityFilter,
  type GroupAuth,
} from "@/lib/groups";
import { ApiError } from "@/lib/http";
import type { LogTextInput } from "@/lib/validation";

// Run text logs (stdout/stderr capture). Insert-only rows with a BigInt PK
// for cursor pagination, mirroring the metrics pattern at smaller volume:
// per-line truncation (never rejection) so logging can never fail on
// content, per-batch + per-run caps, cascade on run delete, and the same
// TTL purge as metrics.

export const LOG_LINE_MAX_CHARS = 4000;
export const LOG_BATCH_MAX_LINES = 500;
export const LOG_MAX_LINES_PER_RUN = 100_000;
export const LOG_LIST_MAX_LIMIT = 1000;
export const LOG_LIST_DEFAULT_LIMIT = 500;

export type LogStream = "stdout" | "stderr";

export interface LogLine {
  id: string;
  stream: string;
  step: number | null;
  text: string;
  wallTime: Date;
}

export async function logTextBatch(
  auth: GroupAuth,
  runId: string,
  input: LogTextInput,
): Promise<{ logged: number }> {
  requireRole(auth, "MEMBER");
  await assertRunWritable(auth, runId);
  const existing = await db.runLog.count({ where: { runId } });
  if (existing + input.lines.length > LOG_MAX_LINES_PER_RUN) {
    throw new ApiError(413, "run already holds 100k log lines");
  }
  await db.runLog.createMany({
    data: input.lines.map((line) => ({
      runId,
      stream: line.stream,
      step: line.step ?? null,
      text:
        line.text.length > LOG_LINE_MAX_CHARS
          ? `${line.text.slice(0, LOG_LINE_MAX_CHARS)}…[truncated]`
          : line.text,
    })),
  });
  return { logged: input.lines.length };
}

export interface LogPage {
  lines: LogLine[];
  total: number;
  /** Exclusive upper-bound id for the next (older) page, or null. */
  nextCursor: string | null;
}

/** Newest-first pages reversed to chronological for display. Default (no
 * cursor) returns the tail; cursor loads strictly older lines. One indexed
 * range scan + one count, both bounded by limit. */
export async function listRunLogs(
  auth: GroupAuth,
  runId: string,
  opts: { cursor?: string; limit?: number; stream?: LogStream } = {},
): Promise<LogPage> {
  const run = await db.run.findFirst({
    where: {
      id: runId,
      project: { orgId: auth.orgId },
      ...runVisibilityFilter(auth),
    },
    select: { id: true },
  });
  if (!run) throw new ApiError(404, "run not found");
  const limit = Math.min(
    Math.max(opts.limit ?? LOG_LIST_DEFAULT_LIMIT, 1),
    LOG_LIST_MAX_LIMIT,
  );
  const where = {
    runId: run.id,
    ...(opts.stream ? { stream: opts.stream } : {}),
    ...(opts.cursor ? { id: { lt: BigInt(opts.cursor) } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.runLog.findMany({
      where,
      orderBy: { id: "desc" },
      take: limit + 1,
      select: {
        id: true,
        stream: true,
        step: true,
        text: true,
        wallTime: true,
      },
    }),
    db.runLog.count({
      where: { runId: run.id, ...(opts.stream ? { stream: opts.stream } : {}) },
    }),
  ]);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  // Cursor first: .reverse() below mutates in place.
  const nextCursor = hasMore ? page[page.length - 1]!.id.toString() : null;
  return {
    lines: [...page].reverse().map((r) => ({
      id: r.id.toString(),
      stream: r.stream,
      step: r.step,
      text: r.text,
      wallTime: r.wallTime,
    })),
    total,
    nextCursor,
  };
}
