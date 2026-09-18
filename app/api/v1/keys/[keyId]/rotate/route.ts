import type { NextRequest } from "next/server";

import { getLiveSession } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { rotateKey } from "@/lib/keys";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ keyId: string }> },
): Promise<Response> {
  try {
    const { keyId } = await ctx.params;
    const session = await getLiveSession(request);
    const { key, plaintext } = await rotateKey(session, keyId);
    return Response.json({ key, plaintext }, { status: 201 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
