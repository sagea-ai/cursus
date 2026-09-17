import type { NextRequest } from "next/server";

import { authenticateApiKey } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { listRuns } from "@/lib/runs";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ project: string }> },
): Promise<Response> {
  try {
    const { project } = await ctx.params;
    const auth = await authenticateApiKey(
      request.headers.get("authorization"),
    );
    const sp = request.nextUrl.searchParams;
    const cursor = sp.get("cursor") ?? undefined;
    const limitRaw = sp.get("limit");
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    return Response.json(
      await listRuns(auth, project, {
        cursor,
        limit: Number.isFinite(limit) ? limit : undefined,
      }),
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
