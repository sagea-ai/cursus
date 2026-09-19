import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { listMediaKeys } from "@/lib/media";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await ctx.params;
    const auth = await authenticateRequest(request);
    return Response.json({ keys: await listMediaKeys(auth, runId) });
  } catch (e) {
    return toErrorResponse(e);
  }
}
