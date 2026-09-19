import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { batchUpdateRuns } from "@/lib/runs";
import { batchRunsSchema } from "@/lib/validation";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ project: string }> },
): Promise<Response> {
  try {
    const { project } = await ctx.params;
    const auth = await authenticateRequest(request);
    const body = batchRunsSchema.parse(await request.json());
    return Response.json(await batchUpdateRuns(auth, project, body));
  } catch (e) {
    return toErrorResponse(e);
  }
}
