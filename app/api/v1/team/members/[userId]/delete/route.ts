import type { NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/http";
import { getLiveSession } from "@/lib/api-auth";
import { deleteMember } from "@/lib/team";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    const { userId } = await ctx.params;
    const session = await getLiveSession(request);
    return Response.json(await deleteMember(session, userId));
  } catch (e) {
    return toErrorResponse(e);
  }
}
