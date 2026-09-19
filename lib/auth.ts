import { createHash, randomBytes } from "node:crypto";

import type { Role } from "@/app/generated/prisma/client";

// Centralized authorization guard.
// ALL role checks go through this function — never inline
// `if (session.role !== ...)` in a route handler. Duplicated auth logic
// across routes is how privilege-escalation bugs happen; the PR checklist
// (§10.4) rejects any new gated route that doesn't use this guard.

export interface Session {
  userId: string;
  orgId: string;
  email: string;
  role: Role;
}

export class AuthError extends Error {
  readonly status: 401 | 403;
  constructor(status: 401 | 403, message: string) {
    super(message);
    this.status = status;
  }
}

export function requireAuth(
  session: Session | null,
): asserts session is Session {
  if (!session) throw new AuthError(401, "authentication required");
}

const ROLE_RANK: Record<Role, number> = {
  VIEWER: 1,
  MEMBER: 2,
  SUPER_ADMIN: 3,
};

export function requireRole(
  session: Session | null,
  min: Role,
): asserts session is Session;
export function requireRole(session: { role: Role } | null, min: Role): void;
export function requireRole(session: { role: Role } | null, min: Role): void {
  if (!session) throw new AuthError(401, "authentication required");
  if ((ROLE_RANK[session.role] ?? 0) < (ROLE_RANK[min] ?? 0)) {
    throw new AuthError(
      403,
      min === "SUPER_ADMIN" ? "super admin only" : "members and above",
    );
  }
}

// --- API keys (SDK auth) ---------------------------------------------------
// Keys are random high-entropy tokens; store only a SHA-256 hash, show the
// plaintext exactly once on creation. Role is looked up live from
// the owning user on every request — never snapshotted — so a demoted user's
// existing keys immediately lose elevated access.

const KEY_PREFIX = "cursus_";

export function generateApiKey(): { plaintext: string; keyHash: string } {
  const plaintext = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { plaintext, keyHash: hashApiKey(plaintext) };
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function isApiKeyFormat(value: string): boolean {
  return value.startsWith(KEY_PREFIX) && value.length > KEY_PREFIX.length + 16;
}
