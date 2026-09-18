import type { NextRequest } from "next/server";

import { db } from "@/lib/db";
import { hashApiKey, isApiKeyFormat, type Session } from "@/lib/auth";
import { isUsablePasswordHash } from "@/lib/password";
import { getSessionFromRequest } from "@/lib/session";

// API-key authentication for SDK-originated requests (PRD §6).
// API keys are NEVER valid for team-management endpoints (§6.2) — those are
// session-only. This module serves ingestion routes only.
//
// NOTE: callers pass `request.headers.get("authorization")` from the Route
// Handler's own request object — never `headers()` from next/headers, which
// is a Server-Component API and does not reliably carry request headers in
// Route Handlers.

export interface KeyAuth {
  orgId: string;
  userId: string;
  email: string;
  role: Session["role"];
  keyId: string;
}

export class KeyAuthError extends Error {
  readonly status: 401 | 403 | 404;
  constructor(status: 401 | 403 | 404, message: string) {
    super(message);
    this.status = status;
  }
}

function bearerFromHeader(value: string | null): string | null {
  if (!value) return null;
  const m = /^Bearer\s+(.+)$/i.exec(value.trim());
  return m ? m[1]!.trim() : null;
}

export async function authenticateApiKey(
  authHeader: string | null,
): Promise<KeyAuth> {
  const plaintext = bearerFromHeader(authHeader);
  if (!plaintext || !isApiKeyFormat(plaintext)) {
    throw new KeyAuthError(401, "missing or malformed API key");
  }
  const keyHash = hashApiKey(plaintext);
  const key = await db.apiKey.findUnique({
    where: { keyHash },
    include: {
      user: { select: { id: true, orgId: true, email: true, role: true } },
    },
  });
  if (!key || key.revokedAt) {
    throw new KeyAuthError(401, "invalid or revoked API key");
  }
  // Live role lookup (PRD §5.2): inherit the owning user's CURRENT role so
  // demotion immediately restricts existing keys. One extra join, worth it.
  await db.apiKey.update({
    where: { id: key.id },
    data: { lastUsedAt: new Date() },
  });
  return {
    orgId: key.orgId,
    userId: key.user.id,
    email: key.user.email,
    role: key.user.role,
    keyId: key.id,
  };
}

/**
 * Live session: verifies the cookie, then re-reads the user row so guards see
 * the CURRENT role — never a stale JWT. A demoted/deactivated user loses
 * access on their very next request, no re-login needed. Every
 * session-guarded route must use this (never the raw JWT claims).
 */
export async function getLiveSession(
  req: NextRequest,
): Promise<Session | null> {
  const claimed = await getSessionFromRequest(req);
  if (!claimed) return null;
  const user = await db.user.findUnique({
    where: { id: claimed.userId },
    select: {
      id: true,
      orgId: true,
      email: true,
      role: true,
      passwordHash: true,
    },
  });
  if (!user) return null;
  // Deactivation must kill existing sessions too: locked/pending hashes can
  // never authenticate, so a stale cookie grants nothing anywhere.
  if (!isUsablePasswordHash(user.passwordHash)) return null;
  return {
    userId: user.id,
    orgId: user.orgId,
    email: user.email,
    role: user.role,
  };
}

export interface RequestAuth {
  orgId: string;
  userId: string;
  email: string;
  role: Session["role"];
  via: "session" | "key";
  keyId?: string;
}

/**
 * Two auth modes on the same API surface (PRD §6): dashboard requests carry
 * the session cookie, SDK requests carry a Bearer key. Session wins when both
 * are present. Team/key-management routes must NOT use this — they are
 * session-only by design (use getLiveSession + requireRole).
 */
export async function authenticateRequest(
  req: NextRequest,
): Promise<RequestAuth> {
  // Live session first (cookie identity + fresh DB role), Bearer key second.
  const live = await getLiveSession(req);
  if (live) return { ...live, via: "session" };
  const key = await authenticateApiKey(req.headers.get("authorization"));
  return { ...key, via: "key" };
}
