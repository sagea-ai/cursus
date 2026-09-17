import type { NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/http";
import { getLiveSession } from "@/lib/api-auth";
import { setMemberRole } from "@/lib/team";
import { updateRoleSchema } from "@/lib/validation";

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    const { userId } = await ctx.params;
    const session = await getLiveSession(request);
    const body = updateRoleSchema.parse(await request.json());
    return Response.json({
      user: await setMemberRole(session, userId, body.role),
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
