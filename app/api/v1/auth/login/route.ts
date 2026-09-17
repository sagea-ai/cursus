import { type NextRequest, NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/http";
import { setSessionCookie, signSession } from "@/lib/session";
import { loginUser } from "@/lib/team";
import { loginSchema } from "@/lib/validation";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = loginSchema.parse(await request.json());
    const { session, user } = await loginUser(body);
    const res = NextResponse.json({ user });
    setSessionCookie(res, await signSession(session));
    return res;
  } catch (e) {
    return toErrorResponse(e);
  }
}
