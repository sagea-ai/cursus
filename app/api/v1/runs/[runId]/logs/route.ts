import type { NextRequest } from "next/server";
import { z } from "zod";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { listRunLogs, logTextBatch } from "@/lib/run-logs";
import { logTextSchema } from "@/lib/validation";

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().optional(),
  stream: z.enum(["stdout", "stderr"]).optional(),
});

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await ctx.params;
    const auth = await authenticateRequest(request);
    const sp = request.nextUrl.searchParams;
    const query = querySchema.parse({
      cursor: sp.get("cursor") ?? undefined,
      limit: sp.get("limit") ?? undefined,
      stream: sp.get("stream") ?? undefined,
    });
    return Response.json(await listRunLogs(auth, runId, query));
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await ctx.params;
    const auth = await authenticateRequest(request);
    const body = logTextSchema.parse(await request.json());
    // 202 like metrics: fire-and-forget from the SDK's perspective.
    return Response.json(await logTextBatch(auth, runId, body), {
      status: 202,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
