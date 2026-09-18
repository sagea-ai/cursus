import type { NextRequest } from "next/server";

import { getLiveSession } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { listProfileRuns } from "@/lib/profile";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const session = await getLiveSession(request);
    const sp = request.nextUrl.searchParams;
    const q = sp.get("q") ?? undefined;
    const limitRaw = sp.get("limit");
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    return Response.json({
      runs: await listProfileRuns(session, {
        q,
        limit: Number.isFinite(limit) ? limit : undefined,
      }),
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
