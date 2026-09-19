import { NextResponse, type NextRequest } from "next/server";

import {
  isOidcEnabled,
  oidcAuthorizationUrl,
  oidcConfig,
  oidcState,
} from "@/lib/oidc";

// Browser entry: stash state+nonce in short-lived httpOnly cookies, then
// redirect to the provider. Unconfigured deployments 404 (no SSO button
// renders either — see the login page).
export async function GET(request: NextRequest): Promise<Response> {
  if (!isOidcEnabled()) {
    return Response.json({ error: "SSO is not configured" }, { status: 404 });
  }
  const origin = request.nextUrl.origin;
  const cfg = oidcConfig(origin);
  if (!cfg) {
    return Response.json({ error: "SSO is not configured" }, { status: 404 });
  }
  const { state, nonce } = oidcState();
  const url = await oidcAuthorizationUrl(cfg, state, nonce);
  const res = NextResponse.redirect(url);
  for (const [name, value] of [
    ["cursus_oidc_state", state],
    ["cursus_oidc_nonce", nonce],
  ] as const) {
    res.cookies.set(name, value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env["NODE_ENV"] === "production",
      maxAge: 600,
      path: "/",
    });
  }
  return res;
}
