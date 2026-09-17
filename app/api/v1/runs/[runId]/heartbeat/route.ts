import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { heartbeat } from "@/lib/runs";

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await ctx.params;
    const auth = await authenticateRequest(request);
    return Response.json(await heartbeat(auth, runId));
  } catch (e) {
    return toErrorResponse(e);
  }
}
