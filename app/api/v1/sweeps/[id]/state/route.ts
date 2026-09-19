import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { setSweepState } from "@/lib/sweeps";
import { setSweepStateSchema } from "@/lib/validation";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const auth = await authenticateRequest(request);
    const body = setSweepStateSchema.parse(await request.json());
    return Response.json(await setSweepState(auth, id, body.state));
  } catch (e) {
    return toErrorResponse(e);
  }
}
