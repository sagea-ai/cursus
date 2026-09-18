import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { listRuns } from "@/lib/runs";
import { runListSortSchema } from "@/lib/validation";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ project: string }> },
): Promise<Response> {
  try {
    const { project } = await ctx.params;
    const auth = await authenticateRequest(request);
    const sp = request.nextUrl.searchParams;
    const cursor = sp.get("cursor") ?? undefined;
    const limitRaw = sp.get("limit");
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    const sort = runListSortSchema.parse(sp.get("sort") ?? undefined);
    return Response.json(
      await listRuns(auth, project, {
        cursor,
        limit: Number.isFinite(limit) ? limit : undefined,
        sort,
      }),
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
