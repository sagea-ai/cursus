import type { NextRequest } from "next/server";

import { getLiveSession } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { getActivity } from "@/lib/profile";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const session = await getLiveSession(request);
    const raw = request.nextUrl.searchParams.get("days");
    const days = raw ? Number.parseInt(raw, 10) : undefined;
    return Response.json(
      await getActivity(session, Number.isFinite(days) ? days : undefined),
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
