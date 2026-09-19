import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { exportProjectMetrics } from "@/lib/export";
import { toErrorResponse } from "@/lib/http";
import { exportQuerySchema } from "@/lib/validation";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ project: string }> },
): Promise<Response> {
  try {
    const { project } = await ctx.params;
    const auth = await authenticateRequest(request);
    const sp = request.nextUrl.searchParams;
    const query = exportQuerySchema.parse({
      format: sp.get("format") ?? undefined,
      key: sp.get("key") ?? undefined,
    });
    // Awaited inside try: a bare return would let service rejections
    // escape toErrorResponse as unhandled 500s.
    return await exportProjectMetrics(auth, project, query);
  } catch (e) {
    return toErrorResponse(e);
  }
}
