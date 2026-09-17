import type { NextRequest } from "next/server";

import { authenticateApiKey } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { logBatch } from "@/lib/runs";
import { logBatchSchema } from "@/lib/validation";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await ctx.params;
    const auth = await authenticateApiKey(
      request.headers.get("authorization"),
    );
    const body = logBatchSchema.parse(await request.json());
    const result = await logBatch(auth, runId, body);
    // 202: fire-and-forget from the SDK's perspective — don't block training.
    return Response.json(result, { status: 202 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
