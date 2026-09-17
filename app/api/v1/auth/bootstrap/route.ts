import { type NextRequest, NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/http";
import { setSessionCookie, signSession } from "@/lib/session";
import { bootstrapOrg } from "@/lib/team";
import { bootstrapSchema } from "@/lib/validation";

// First-boot provisioning (§5.1): allowed ONLY while the users table is
// empty. There is no public self-serve org creation — after bootstrap this
// endpoint is permanently 403 and accounts exist via invite only.
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = bootstrapSchema.parse(await request.json());
    const { org, user } = await bootstrapOrg(body);
    const res = NextResponse.json({ org, user }, { status: 201 });
    setSessionCookie(
      res,
      await signSession({
        userId: user.id,
        orgId: org.id,
        email: user.email,
        role: user.role,
      }),
    );
    return res;
  } catch (e) {
    return toErrorResponse(e);
  }
}
