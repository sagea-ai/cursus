import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { nextTrial } from "@/lib/sweeps";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const auth = await authenticateRequest(request);
    const trial = await nextTrial(auth, id);
    // 204 on exhaustion: clean worker-loop exit, not an error.
    if (!trial) return new Response(null, { status: 204 });
    return Response.json(trial);
  } catch (e) {
    return toErrorResponse(e);
  }
}
