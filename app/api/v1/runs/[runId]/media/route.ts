import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { listMedia } from "@/lib/media";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await ctx.params;
    const auth = await authenticateRequest(request);
    const key = new URL(request.url).searchParams.get("key") ?? "";
    if (!key) {
      return Response.json({ error: "key is required" }, { status: 400 });
    }
    return Response.json({ steps: await listMedia(auth, runId, key) });
  } catch (e) {
    return toErrorResponse(e);
  }
}
