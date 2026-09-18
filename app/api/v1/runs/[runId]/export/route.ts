import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { exportRunMetrics } from "@/lib/export";
import { toErrorResponse } from "@/lib/http";
import { exportQuerySchema } from "@/lib/validation";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await ctx.params;
    const auth = await authenticateRequest(request);
    const query = exportQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    return await exportRunMetrics(auth, runId, query);
  } catch (e) {
    return toErrorResponse(e);
  }
}
