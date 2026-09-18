import type { NextRequest } from "next/server";

import { getLiveSession } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { removeGroupMember } from "@/lib/groups";

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string; userId: string }> },
): Promise<Response> {
  try {
    const { slug, userId } = await ctx.params;
    const session = await getLiveSession(request);
    return Response.json(await removeGroupMember(session, slug, userId));
  } catch (e) {
    return toErrorResponse(e);
  }
}
