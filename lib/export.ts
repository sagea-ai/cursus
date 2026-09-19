import { toCsvCell } from "@/lib/csv";
import { db } from "@/lib/db";
import {
  projectVisibilityFilter,
  runVisibilityFilter,
  type GroupAuth,
} from "@/lib/groups";
import { slugify } from "@/lib/slug";
import type { ExportQuery } from "@/lib/validation";
import { KeyAuthError } from "@/lib/api-auth";
import { ApiError } from "@/lib/http";

// Metric export (CSV/JSON download). Rows stream in batches ordered by
// insertion (BigInt PK cursor) — a full run never sits in server memory, no
// matter how many steps it logged. Insertion order ≈ log order for a run
// (single-writer appends); consumers that need strict step ordering sort one
// column client-side.

export const EXPORT_BATCH_SIZE = 5000;

interface ExportRow {
  key: string;
  step: number;
  value: number;
  wallTime: Date;
}

function csvChunk(rows: ExportRow[]): string {
  return (
    rows
      .map(
        (r) =>
          `${toCsvCell(r.key)},${r.step},${r.value},${r.wallTime.toISOString()}`,
      )
      .join("\n") + "\n"
  );
}

function jsonChunk(rows: ExportRow[]): string {
  return rows
    .map(
      (r) =>
        `{"key":${JSON.stringify(r.key)},"step":${r.step},"value":${r.value},"wall_time":${JSON.stringify(r.wallTime.toISOString())}}`,
    )
    .join(",");
}

export async function exportRunMetrics(
  auth: GroupAuth,
  runId: string,
  query: ExportQuery,
): Promise<Response> {
  const run = await db.run.findFirst({
    where: {
      id: runId,
      project: { orgId: auth.orgId },
      ...runVisibilityFilter(auth),
    },
    select: { id: true, name: true },
  });
  if (!run) throw new KeyAuthError(404, "run not found");

  const format = query.format;
  const filename = `cursus-${slugify(run.name) || run.id}-metrics.${format}`;
  const encoder = new TextEncoder();
  let cursor: bigint | undefined = undefined;
  let opened = false;
  let finished = false;

  const stream = new ReadableStream({
    async pull(controller) {
      if (finished) {
        controller.close();
        return;
      }
      let rows;
      try {
        rows = await db.metric.findMany({
          where: {
            runId,
            ...(query.key ? { key: query.key } : {}),
            ...(cursor !== undefined ? { id: { gt: cursor } } : {}),
          },
          orderBy: { id: "asc" },
          take: EXPORT_BATCH_SIZE,
          select: {
            id: true,
            key: true,
            step: true,
            value: true,
            wallTime: true,
          },
        });
      } catch (e) {
        controller.error(e);
        return;
      }
      if (rows.length > 0) {
        cursor = rows[rows.length - 1]!.id;
      }
      let chunk = "";
      if (!opened) {
        opened = true;
        if (format === "csv") {
          chunk += "key,step,value,wall_time\n";
        } else {
          chunk += `{"run_id":${JSON.stringify(runId)},"exported_at":${JSON.stringify(new Date().toISOString())},"points":[`;
        }
      } else if (format === "json" && rows.length > 0) {
        chunk += ",";
      }
      if (rows.length > 0) {
        chunk += format === "csv" ? csvChunk(rows) : jsonChunk(rows);
      }
      if (rows.length < EXPORT_BATCH_SIZE) {
        if (format === "json") chunk += "]}";
        finished = true;
      }
      controller.enqueue(encoder.encode(chunk));
      if (finished) controller.close();
    },
    cancel() {
      finished = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type":
        format === "csv" ? "text/csv; charset=utf-8" : "application/json",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

export const PROJECT_EXPORT_RUN_CAP = 50_000;
const PROJECT_EXPORT_RUN_BATCH = 500;

// Project export: every visible run's metrics in one download. Two nested
// cursors (runs by id, then metric PK per run) keep server memory flat no
// matter how many runs/steps the project holds. Members get exactly their
// visible subset — the same filter as the runs list.
export async function exportProjectMetrics(
  auth: GroupAuth,
  projectSlug: string,
  query: ExportQuery,
): Promise<Response> {
  const project = await db.project.findFirst({
    where: {
      orgId: auth.orgId,
      slug: projectSlug,
      ...projectVisibilityFilter(auth),
    },
    select: { id: true, slug: true },
  });
  if (!project) throw new KeyAuthError(404, "project not found");

  const runCount = await db.run.count({
    where: { projectId: project.id, ...runVisibilityFilter(auth) },
  });
  if (runCount > PROJECT_EXPORT_RUN_CAP) {
    throw new ApiError(
      400,
      "project exceeds the 50k-run export cap — narrow it down first",
    );
  }

  const format = query.format;
  const filename = `cursus-${project.slug}-metrics.${format}`;
  const encoder = new TextEncoder();
  const runWhere = { projectId: project.id, ...runVisibilityFilter(auth) };
  let runCursor: string | undefined = undefined;
  let runQueue: { id: string; name: string }[] = [];
  let runsExhausted = false;
  let metricCursor: bigint | undefined = undefined;
  let activeRun: { id: string; name: string } | null = null;
  let opened = false;
  let firstRun = true;
  let finished = false;

  async function nextMetricBatch(): Promise<ExportRow[]> {
    const rows = await db.metric.findMany({
      where: {
        runId: activeRun!.id,
        ...(query.key ? { key: query.key } : {}),
        ...(metricCursor !== undefined ? { id: { gt: metricCursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: EXPORT_BATCH_SIZE,
      select: { id: true, key: true, step: true, value: true, wallTime: true },
    });
    if (rows.length > 0) metricCursor = rows[rows.length - 1]!.id;
    return rows;
  }

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        let chunk = "";
        if (!opened) {
          opened = true;
          chunk +=
            format === "csv"
              ? "run_id,run_name,key,step,value,wall_time\n"
              : `{"project":${JSON.stringify(project.slug)},"exported_at":${JSON.stringify(new Date().toISOString())},"runs":[`;
        }
        // Emit at least one batch per pull; runs advance inside the loop.
        for (;;) {
          if (!activeRun) {
            if (runQueue.length === 0) {
              if (runsExhausted) break;
              runQueue = await db.run.findMany({
                where: {
                  ...runWhere,
                  ...(runCursor !== undefined ? { id: { gt: runCursor } } : {}),
                },
                orderBy: { id: "asc" },
                take: PROJECT_EXPORT_RUN_BATCH,
                select: { id: true, name: true },
              });
              if (runQueue.length === 0) {
                runsExhausted = true;
                break;
              }
              if (runQueue.length < PROJECT_EXPORT_RUN_BATCH) {
                runsExhausted = true;
              }
              runCursor = runQueue[runQueue.length - 1]!.id;
            }
            activeRun = runQueue.shift()!;
            metricCursor = undefined;
            if (format === "json") {
              chunk += `${firstRun ? "" : ","}{"run_id":${JSON.stringify(activeRun.id)},"run_name":${JSON.stringify(activeRun.name)},"points":[`;
              firstRun = false;
            }
          }
          const rows = await nextMetricBatch();
          if (format === "csv") {
            if (rows.length > 0) {
              chunk +=
                rows
                  .map(
                    (r) =>
                      `${toCsvCell(activeRun!.id)},${toCsvCell(activeRun!.name)},${toCsvCell(r.key)},${r.step},${r.value},${r.wallTime.toISOString()}`,
                  )
                  .join("\n") + "\n";
            }
          } else {
            if (rows.length > 0) {
              chunk += (chunk.endsWith("[") ? "" : ",") + jsonChunk(rows);
            }
          }
          if (rows.length < EXPORT_BATCH_SIZE) {
            if (format === "json") chunk += "]}";
            activeRun = null;
            if (runsExhausted && runQueue.length === 0) break;
            // Keep pulling runs within this tick only if the chunk is
            // still small — bounds per-pull work for huge projects.
            if (chunk.length > 256 * 1024) break;
          } else {
            break;
          }
        }
        if (runsExhausted && runQueue.length === 0 && !activeRun) {
          if (format === "json") chunk += "]}";
          finished = true;
        }
        controller.enqueue(encoder.encode(chunk));
        if (finished) controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
    cancel() {
      finished = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type":
        format === "csv" ? "text/csv; charset=utf-8" : "application/json",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
