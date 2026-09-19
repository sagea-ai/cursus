import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { getSweep, listSweepRuns } from "@/lib/sweeps";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const auth = await authenticateRequest(request);
    const sweep = await getSweep(auth, id);
    const runs = await listSweepRuns(auth, id);
    return Response.json({ sweep, runs });
  } catch (e) {
    return toErrorResponse(e);
  }
}
