import type { NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/http";
import { revokeKey } from "@/lib/keys";
import { getLiveSession } from "@/lib/api-auth";

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ keyId: string }> },
): Promise<Response> {
  try {
    const { keyId } = await ctx.params;
    const session = await getLiveSession(request);
    return Response.json(await revokeKey(session, keyId));
  } catch (e) {
    return toErrorResponse(e);
  }
}
