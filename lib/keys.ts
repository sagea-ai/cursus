import { requireRole, type Session } from "@/lib/auth";
import { generateApiKey } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/http";

// API-key self-service (PRD §7.9). Session-only routes — keys are never valid
// for management endpoints (§6.2). Members see/revoke their own keys;
// super admins see/revoke every key in the org.

export interface PublicKey {
  id: string;
  label: string;
  ownerEmail?: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export async function listKeys(session: Session | null): Promise<PublicKey[]> {
  requireRole(session, "MEMBER");
  const isAdmin = session.role === "SUPER_ADMIN";
  const rows = await db.apiKey.findMany({
    where: isAdmin
      ? { orgId: session.orgId }
      : { orgId: session.orgId, userId: session.userId },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { email: true } } },
  });
  return rows.map((k) => ({
    id: k.id,
    label: k.label,
    ...(isAdmin ? { ownerEmail: k.user.email } : {}),
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    revokedAt: k.revokedAt,
  }));
}

export async function createKey(
  session: Session | null,
  label: string,
): Promise<{ key: PublicKey; plaintext: string }> {
  requireRole(session, "MEMBER");
  const { plaintext, keyHash } = generateApiKey();
  const row = await db.apiKey.create({
    data: {
      orgId: session.orgId,
      userId: session.userId,
      keyHash,
      label,
    },
  });
  // Plaintext is returned exactly once — never stored, never re-readable.
  return {
    key: {
      id: row.id,
      label: row.label,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
    },
    plaintext,
  };
}

export async function revokeKey(
  session: Session | null,
  keyId: string,
): Promise<{ id: string }> {
  requireRole(session, "MEMBER");
  const row = await db.apiKey.findFirst({
    where: { id: keyId, orgId: session.orgId },
    select: { id: true, userId: true, revokedAt: true },
  });
  if (!row) throw new ApiError(404, "key not found");
  if (row.userId !== session.userId && session.role !== "SUPER_ADMIN") {
    // Same 404-vs-403 question as members: use 403 here since key IDs are
    // unguessable CUIDs — no enumeration oracle, clearer client error.
    throw new ApiError(403, "cannot revoke another user's key");
  }
  await db.apiKey.update({
    where: { id: row.id },
    data: { revokedAt: new Date() },
  });
  return { id: row.id };
}
