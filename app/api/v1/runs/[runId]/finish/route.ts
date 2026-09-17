import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { finishRun } from "@/lib/runs";
import { finishRunSchema } from "@/lib/validation";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await ctx.params;
    const auth = await authenticateRequest(request);
    const body = finishRunSchema.parse(await request.json());
    return Response.json(await finishRun(auth, runId, body));
  } catch (e) {
    return toErrorResponse(e);
  }
}
