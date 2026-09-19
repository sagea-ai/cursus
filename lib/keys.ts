import { requireAuth, type Session } from "@/lib/auth";
import { generateApiKey } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/http";

// API-key self-service. Session-only routes — keys are never valid
// for management endpoints. Members see/revoke their own keys;
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
  requireAuth(session);
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
  requireAuth(session);
  const { plaintext, keyHash } = generateApiKey();
  // Key row + audit event commit atomically: a key must never exist without
  // its creation record (or vice versa).
  const row = await db.$transaction(async (tx) => {
    const created = await tx.apiKey.create({
      data: {
        orgId: session.orgId,
        userId: session.userId,
        keyHash,
        label,
      },
    });
    await tx.auditEvent.create({
      data: {
        orgId: session.orgId,
        actorId: session.userId,
        action: "api_key.created",
        targetType: "api_key",
        targetId: created.id,
        metadata: { label },
      },
    });
    return created;
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
  requireAuth(session);
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
  await db.$transaction([
    db.apiKey.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    }),
    db.auditEvent.create({
      data: {
        orgId: session.orgId,
        actorId: session.userId,
        action: "api_key.revoked",
        targetType: "api_key",
        targetId: row.id,
        metadata: {},
      },
    }),
  ]);
  return { id: row.id };
}

/**
 * Rotate ("reshuffle") a key: issue a replacement and revoke the old one
 * atomically. Same ownership rule as revoke. The new plaintext is returned
 * exactly once, like creation.
 */ export async function rotateKey(
  session: Session | null,
  keyId: string,
): Promise<{ key: PublicKey; plaintext: string }> {
  requireAuth(session);
  const row = await db.apiKey.findFirst({
    where: { id: keyId, orgId: session.orgId },
    select: { id: true, userId: true, label: true, revokedAt: true },
  });
  if (!row) throw new ApiError(404, "key not found");
  if (row.userId !== session.userId && session.role !== "SUPER_ADMIN") {
    throw new ApiError(403, "cannot rotate another user's key");
  }
  if (row.revokedAt) throw new ApiError(409, "key is already revoked");
  const { plaintext, keyHash } = generateApiKey();
  const now = new Date();
  // Replacement + revocation + audit trail commit atomically: rotating must
  // never mint a key without killing the old one (or vice versa).
  const created = await db.$transaction(async (tx) => {
    const replacement = await tx.apiKey.create({
      data: {
        orgId: session.orgId,
        userId: row.userId,
        keyHash,
        label: row.label,
      },
    });
    await tx.apiKey.update({
      where: { id: row.id },
      data: { revokedAt: now },
    });
    await tx.auditEvent.create({
      data: {
        orgId: session.orgId,
        actorId: session.userId,
        action: "api_key.rotated",
        targetType: "api_key",
        targetId: row.id,
        metadata: { label: row.label, replacementId: replacement.id },
      },
    });
    return replacement;
  });
  return {
    key: {
      id: created.id,
      label: created.label,
      createdAt: created.createdAt,
      lastUsedAt: created.lastUsedAt,
      revokedAt: created.revokedAt,
    },
    plaintext,
  };
}

export interface KeyEvent {
  id: string;
  action: string;
  createdAt: Date;
  actor: { email: string; name: string };
  metadata: unknown;
}

export interface KeyDetail extends PublicKey {
  events: KeyEvent[];
}

/**
 * One key plus its audit trail: events targeting it, plus the rotation
 * event that birthed it (referenced via metadata, so a replacement's page
 * shows where it came from). Same ownership rule as revoke — members see
 * only their own keys' history.
 */
export async function getKeyDetail(
  session: Session | null,
  keyId: string,
): Promise<KeyDetail> {
  requireAuth(session);
  const row = await db.apiKey.findFirst({
    where: { id: keyId, orgId: session.orgId },
    include: { user: { select: { email: true } } },
  });
  if (!row) throw new ApiError(404, "key not found");
  if (row.userId !== session.userId && session.role !== "SUPER_ADMIN") {
    throw new ApiError(403, "cannot view another user's key");
  }
  const events = await db.auditEvent.findMany({
    where: {
      orgId: session.orgId,
      OR: [
        { targetId: row.id },
        { metadata: { path: ["replacementId"], equals: row.id } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      id: true,
      action: true,
      createdAt: true,
      metadata: true,
      actor: { select: { email: true, name: true } },
    },
  });
  return {
    id: row.id,
    label: row.label,
    ownerEmail: row.user.email,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    events,
  };
}
