import type { NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/http";
import { getLiveSession } from "@/lib/api-auth";
import { reactivateMember } from "@/lib/team";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    const { userId } = await ctx.params;
    const session = await getLiveSession(request);
    const { user, inviteUrl } = await reactivateMember(session, userId);
    return Response.json({ user, inviteUrl });
  } catch (e) {
    return toErrorResponse(e);
  }
}
