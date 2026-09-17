import { type NextRequest, NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/http";
import { setSessionCookie, signSession } from "@/lib/session";
import { acceptInvite } from "@/lib/team";
import { acceptInviteSchema } from "@/lib/validation";

// Invitee sets their password from the emailed/copied link (§5.3) and lands
// logged in. Single-use: valid only while the account is invite-pending.
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = acceptInviteSchema.parse(await request.json());
    const { session, user, org } = await acceptInvite(body);
    const res = NextResponse.json({ user, org }, { status: 200 });
    setSessionCookie(res, await signSession(session));
    return res;
  } catch (e) {
    return toErrorResponse(e);
  }
}
