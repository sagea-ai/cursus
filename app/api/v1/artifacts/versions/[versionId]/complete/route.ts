import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { completeArtifactUpload } from "@/lib/artifacts";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ versionId: string }> },
): Promise<Response> {
  try {
    const { versionId } = await ctx.params;
    const auth = await authenticateRequest(request);
    return Response.json(await completeArtifactUpload(auth, versionId));
  } catch (e) {
    return toErrorResponse(e);
  }
}
