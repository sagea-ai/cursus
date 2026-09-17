import type { NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/http";
import { previewInvite } from "@/lib/team";

// Public invite preview for /invite/:token (the token itself is the auth).
// Shows the org name + email so the invitee knows what they're accepting.
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  try {
    const { token } = await ctx.params;
    return Response.json(await previewInvite(decodeURIComponent(token)));
  } catch (e) {
    return toErrorResponse(e);
  }
}
