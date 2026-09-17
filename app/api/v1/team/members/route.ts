import type { NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/http";
import { getLiveSession } from "@/lib/api-auth";
import { listMembers } from "@/lib/team";

// Any member can list the org (read-only for members, §7.8).
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const session = await getLiveSession(request);
    return Response.json({ members: await listMembers(session) });
  } catch (e) {
    return toErrorResponse(e);
  }
}
