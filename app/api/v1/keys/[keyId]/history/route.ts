import type { NextRequest } from "next/server";

import { getLiveSession } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { getKeyDetail } from "@/lib/keys";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ keyId: string }> },
): Promise<Response> {
  try {
    const { keyId } = await ctx.params;
    const session = await getLiveSession(request);
    return Response.json(await getKeyDetail(session, keyId));
  } catch (e) {
    return toErrorResponse(e);
  }
}
