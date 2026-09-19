import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { completeMediaUpload } from "@/lib/media";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string; mediaId: string }> },
): Promise<Response> {
  try {
    const { runId, mediaId } = await ctx.params;
    const auth = await authenticateRequest(request);
    return Response.json(await completeMediaUpload(auth, runId, mediaId));
  } catch (e) {
    return toErrorResponse(e);
  }
}
