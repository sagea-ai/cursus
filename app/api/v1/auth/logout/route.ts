import { NextResponse } from "next/server";

import { clearSessionCookie } from "@/lib/session";

export async function POST(): Promise<Response> {
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}
