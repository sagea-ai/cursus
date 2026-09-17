import { db } from "@/lib/db";
import { hashApiKey, isApiKeyFormat, type Session } from "@/lib/auth";

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
    include: { user: { select: { id: true, orgId: true, email: true, role: true } } },
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
