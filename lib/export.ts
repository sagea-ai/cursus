import { db } from "@/lib/db";
import { slugify } from "@/lib/runs";
import type { ExportQuery } from "@/lib/validation";
import { KeyAuthError } from "@/lib/api-auth";

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

/** Minimal RFC-4180 cell escaping (keys are user-controlled strings). */
export function toCsvCell(value: string | number): string {
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
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
  auth: { orgId: string },
  runId: string,
  query: ExportQuery,
): Promise<Response> {
  const run = await db.run.findFirst({
    where: { id: runId, project: { orgId: auth.orgId } },
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
