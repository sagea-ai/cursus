import { createHash, randomBytes } from "node:crypto";

import type { Role } from "@/app/generated/prisma/client";

// Centralized authorization guard (PRD §5.2 / §10.1).
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

export function requireRole(
  session: Session | null,
  role: Role,
): asserts session is Session {
  requireAuth(session);
  if (role === "SUPER_ADMIN" && session.role !== "SUPER_ADMIN") {
    throw new AuthError(403, "super admin only");
  }
  // MEMBER is the baseline: any authenticated session satisfies it.
}

// --- API keys (SDK auth, PRD §6) -------------------------------------------
// Keys are random high-entropy tokens; store only a SHA-256 hash, show the
// plaintext exactly once on creation (PRD §7.9). Role is looked up live from
// the owning user on every request — never snapshotted — so a demoted user's
// existing keys immediately lose elevated access (PRD §5.2).

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
