import { NextResponse, type NextRequest } from "next/server";

import { setSessionCookie, signSession } from "@/lib/session";
import { ApiError } from "@/lib/http";
import { loginWithOidc, oidcConfig, verifyOidcCallback } from "@/lib/oidc";

// Provider returns here. Failures redirect to /login with a generic error
// (same message for every refusal — no oracle on accounts or config).
export async function GET(request: NextRequest): Promise<Response> {
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${reason}`, request.url));
  try {
    const origin = request.nextUrl.origin;
    const cfg = oidcConfig(origin);
    if (!cfg) return fail("sso-unavailable");
    const sp = request.nextUrl.searchParams;
    if (sp.get("error")) return fail("sso-cancelled");
    const code = sp.get("code");
    const state = sp.get("state");
    const wantState = request.cookies.get("cursus_oidc_state")?.value;
    const nonce = request.cookies.get("cursus_oidc_nonce")?.value;
    if (!code || !state || !wantState || !nonce || state !== wantState) {
      return fail("sso-failed");
    }
    const claims = await verifyOidcCallback(cfg, code, nonce);
    const { session, orgSlug } = await loginWithOidc(cfg, claims);
    const res = NextResponse.redirect(
      new URL(`/${orgSlug}/dashboard`, request.url),
    );
    setSessionCookie(res, await signSession(session));
    res.cookies.delete("cursus_oidc_state");
    res.cookies.delete("cursus_oidc_nonce");
    return res;
  } catch (e) {
    if (e instanceof ApiError) return fail("sso-failed");
    throw e;
  }
}
