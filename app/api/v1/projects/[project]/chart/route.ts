import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { getOverlaySeries } from "@/lib/runs";
import { overlayChartSchema } from "@/lib/validation";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ project: string }> },
): Promise<Response> {
  try {
    const { project } = await ctx.params;
    const auth = await authenticateRequest(request);
    const sp = request.nextUrl.searchParams;
    const query = overlayChartSchema.parse({
      key: sp.get("key") ?? undefined,
      runs: sp.get("runs") ?? undefined,
      max_points: sp.get("max_points") ?? undefined,
    });
    return Response.json(
      await getOverlaySeries(
        auth,
        project,
        query.key,
        query.runs,
        query.max_points,
      ),
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
