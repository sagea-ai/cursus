import type { NextRequest } from "next/server";

import { authenticateApiKey } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { getMetrics } from "@/lib/runs";
import { metricsQuerySchema } from "@/lib/validation";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await ctx.params;
    const auth = await authenticateApiKey(request.headers.get("authorization"));
    const query = metricsQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    return Response.json(
      await getMetrics(auth, runId, {
        key: query.key,
        maxPoints: query.max_points,
        afterStep: query.after_step,
      }),
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
