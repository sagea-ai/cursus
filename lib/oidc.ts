import { randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { db } from "@/lib/db";
import { ApiError } from "@/lib/http";
import {
  isInvitePendingHash,
  isSessionAliveHash,
  ssoOnlyHash,
} from "@/lib/password";
import type { Session } from "@/lib/auth";


// SSO via OIDC (one provider protocol), bridged into the existing cookie
// model: after the callback verifies the ID token, the account gets a plain
// HS256 session like any password login — every downstream guard (live
// role, deactivation, statuses) applies unchanged.
//
// Env-gated (all-or-nothing): OIDC_ISSUER + OIDC_CLIENT_ID +
// OIDC_CLIENT_SECRET enable it; OIDC_REDIRECT_URI overrides the derived
// callback URL (needed behind proxies); OIDC_ALLOWED_DOMAINS optionally
// restricts emails. Unset = zero behavior change.

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowedDomains: string[];
}

export function oidcConfig(requestOrigin?: string): OidcConfig | null {
  const issuer = process.env["OIDC_ISSUER"]?.trim().replace(/\/+$/, "");
  const clientId = process.env["OIDC_CLIENT_ID"]?.trim();
  const clientSecret = process.env["OIDC_CLIENT_SECRET"]?.trim();
  if (!issuer || !clientId || !clientSecret) return null;
  const redirectUri =
    process.env["OIDC_REDIRECT_URI"]?.trim() ||
    (requestOrigin ? `${requestOrigin}/api/v1/auth/oidc/callback` : "");
  if (!redirectUri) {
    throw new ApiError(500, "SSO needs OIDC_REDIRECT_URI behind this setup");
  }
  const allowedDomains = (process.env["OIDC_ALLOWED_DOMAINS"] ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return { issuer, clientId, clientSecret, redirectUri, allowedDomains };
}

export function isOidcEnabled(): boolean {
  return Boolean(
    process.env["OIDC_ISSUER"]?.trim() &&
    process.env["OIDC_CLIENT_ID"]?.trim() &&
    process.env["OIDC_CLIENT_SECRET"]?.trim(),
  );
}

export function oidcState(): { state: string; nonce: string } {
  return {
    state: randomBytes(16).toString("base64url"),
    nonce: randomBytes(16).toString("base64url"),
  };
}

export async function oidcAuthorizationUrl(
  cfg: OidcConfig,
  state: string,
  nonce: string,
): Promise<string> {
  const meta = await fetchDiscovery(cfg.issuer);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
  });
  return `${meta.authorization_endpoint}?${params.toString()}`;
}

interface DiscoveryDoc {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

async function fetchDiscovery(issuer: string): Promise<DiscoveryDoc> {
  const res = await fetch(`${issuer}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new ApiError(502, "SSO provider discovery failed");
  const doc = (await res.json()) as Partial<DiscoveryDoc>;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new ApiError(502, "SSO provider discovery is incomplete");
  }
  return doc as DiscoveryDoc;
}

export interface OidcClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/** Exchange code → verify ID token (JWKS, issuer, audience, nonce).
 * Throws 4xx with non-enumerating messages (same shape for every refusal
 * except domain policy, which is deployment config, not user data). */
export async function verifyOidcCallback(
  cfg: OidcConfig,
  code: string,
  nonce: string,
): Promise<OidcClaims> {
  const meta = await fetchDiscovery(cfg.issuer);
  const tokenRes = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) throw new ApiError(400, "SSO sign-in failed");
  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) throw new ApiError(400, "SSO sign-in failed");
  const jwks = createRemoteJWKSet(new URL(meta.jwks_uri));
  let payload;
  try {
    ({ payload } = await jwtVerify(tokens.id_token, jwks, {
      issuer: meta.issuer || cfg.issuer,
      audience: cfg.clientId,
    }));
  } catch {
    throw new ApiError(400, "SSO sign-in failed");
  }
  const {
    sub,
    email,
    email_verified,
    name,
    nonce: gotNonce,
  } = payload as Record<string, unknown>;
  if (
    typeof sub !== "string" ||
    typeof email !== "string" ||
    gotNonce !== nonce
  ) {
    throw new ApiError(400, "SSO sign-in failed");
  }
  return {
    sub,
    email: email.trim().toLowerCase(),
    emailVerified: email_verified === true,
    name: typeof name === "string" && name.trim() ? name.trim() : "",
  };
}

/** Link or provision the account for verified claims, then mint a session.
 * Resolution order: SSO subject → email. Deactivated rows stay dead even
 * over SSO; pending invites activate with the token's display name. */
export async function loginWithOidc(
  cfg: OidcConfig,
  claims: OidcClaims,
): Promise<{ session: Session; orgSlug: string; created: boolean }> {
  if (!claims.emailVerified) {
    throw new ApiError(403, "SSO email is not verified");
  }
  const domain = claims.email.split("@")[1] ?? "";
  if (cfg.allowedDomains.length > 0 && !cfg.allowedDomains.includes(domain)) {
    throw new ApiError(403, "SSO email domain is not allowed");
  }
  const subject = `${cfg.issuer}|${claims.sub}`;
  const existing =
    (await db.user.findUnique({ where: { ssoSubject: subject } })) ??
    (await db.user.findUnique({ where: { email: claims.email } }));
  if (existing) {
    if (
      !isSessionAliveHash(existing.passwordHash) &&
      !isInvitePendingHash(existing.passwordHash)
    ) {
      // Locked accounts stay dead — SSO must not resurrect deactivation.
      // (Invite-pending rows pass through to activation below.)
      throw new ApiError(403, "account is deactivated");
    }
    const updates: {
      ssoSubject?: string;
      name?: string;
      passwordHash?: string;
    } = {};
    if (existing.ssoSubject !== subject) updates.ssoSubject = subject;
    if (isInvitePendingHash(existing.passwordHash)) {
      // Pending invite activating over SSO: claim the token's display name
      // when the row is nameless, and become SSO-only (no password was
      // ever set — nothing is taken away).
      updates.passwordHash = ssoOnlyHash();
      if (!existing.name && claims.name) updates.name = claims.name;
    }
    const user =
      Object.keys(updates).length > 0
        ? await db.user.update({ where: { id: existing.id }, data: updates })
        : existing;
    const org = await db.org.findUniqueOrThrow({ where: { id: user.orgId } });
    return {
      session: {
        userId: user.id,
        orgId: user.orgId,
        email: user.email,
        role: user.role,
      },
      orgSlug: org.slug,
      created: false,
    };
  }
  // JIT provisioning target: OIDC_ORG_SLUG pins it; otherwise the DB must
  // hold exactly one org (multi-org SSO routing is out of scope — pin it).
  const pinned = process.env["OIDC_ORG_SLUG"]?.trim();
  const org = pinned
    ? await db.org.findUnique({ where: { slug: pinned } })
    : await db.org.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) {
    throw new ApiError(
      400,
      pinned
        ? "SSO org pin does not match any org"
        : "SSO sign-in needs a provisioned org",
    );
  }
  if (!pinned) {
    const orgCount = await db.org.count();
    if (orgCount !== 1) {
      throw new ApiError(
        400,
        "SSO provisioning needs OIDC_ORG_SLUG with multiple orgs",
      );
    }
  }
  const created = await db.user.create({
    data: {
      orgId: org.id,
      email: claims.email,
      name: claims.name,
      passwordHash: ssoOnlyHash(),
      role: "MEMBER",
      ssoSubject: subject,
    },
  });
  return {
    session: {
      userId: created.id,
      orgId: created.orgId,
      email: created.email,
      role: created.role,
    },
    orgSlug: org.slug,
    created: true,
  };
}
