import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { updateRunConfig } from "@/lib/runs";
import { updateRunConfigSchema } from "@/lib/validation";

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await ctx.params;
    const auth = await authenticateRequest(request);
    const body = updateRunConfigSchema.parse(await request.json());
    return Response.json(await updateRunConfig(auth, runId, body.config));
  } catch (e) {
    return toErrorResponse(e);
  }
}
