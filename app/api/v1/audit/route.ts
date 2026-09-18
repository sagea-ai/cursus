import type { NextRequest } from "next/server";

import { getLiveSession } from "@/lib/api-auth";
import { listAuditEvents } from "@/lib/audit";
import { toErrorResponse } from "@/lib/http";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const session = await getLiveSession(request);
    return Response.json({ events: await listAuditEvents(session) });
  } catch (e) {
    return toErrorResponse(e);
  }
}
