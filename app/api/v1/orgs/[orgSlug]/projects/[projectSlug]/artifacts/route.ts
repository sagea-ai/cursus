import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { listArtifacts } from "@/lib/artifacts";
import { toErrorResponse } from "@/lib/http";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ orgSlug: string; projectSlug: string }> },
): Promise<Response> {
  try {
    const { projectSlug } = await ctx.params;
    const auth = await authenticateRequest(request);
    return Response.json({
      artifacts: await listArtifacts(auth, projectSlug),
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
