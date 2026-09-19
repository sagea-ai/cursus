import type { NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/http";
import { getLiveSession } from "@/lib/api-auth";
import { renameMember } from "@/lib/team";
import { renameMemberSchema } from "@/lib/validation";

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    const { userId } = await ctx.params;
    const session = await getLiveSession(request);
    const body = renameMemberSchema.parse(await request.json());
    return Response.json({
      user: await renameMember(session, userId, body.name),
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
