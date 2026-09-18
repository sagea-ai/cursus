import { requireAuth, type Session } from "@/lib/auth";
import { db } from "@/lib/db";

// Append-only audit log. Rows are written alongside the action they record
// and never updated or deleted by the app. Reads are bounded (newest first,
// capped) and scoped: super admins see the org's events; members see events
// they performed plus events targeting their own keys.

export const AUDIT_ACTIONS = [
  "api_key.created",
  "api_key.rotated",
  "api_key.revoked",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export async function logAuditEvent(opts: {
  orgId: string;
  actorId: string;
  action: AuditAction;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.auditEvent.create({
    data: {
      orgId: opts.orgId,
      actorId: opts.actorId,
      action: opts.action,
      targetType: opts.targetType,
      targetId: opts.targetId,
      metadata: (opts.metadata ?? {}) as object,
    },
  });
}

export interface AuditEventRow {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: unknown;
  createdAt: Date;
  actor: { email: string; name: string };
}

export async function listAuditEvents(
  session: Session | null,
  opts: { limit?: number } = {},
): Promise<AuditEventRow[]> {
  requireAuth(session);
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  // Member scope: own actions + actions on own keys. One extra indexed
  // lookup for their key ids; admins skip it entirely.
  const where =
    session.role === "SUPER_ADMIN"
      ? { orgId: session.orgId }
      : {
          orgId: session.orgId,
          OR: [
            { actorId: session.userId },
            {
              targetType: "api_key",
              targetId: {
                in: (
                  await db.apiKey.findMany({
                    where: { userId: session.userId },
                    select: { id: true },
                  })
                ).map((k) => k.id),
              },
            },
          ],
        };
  const rows = await db.auditEvent.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      metadata: true,
      createdAt: true,
      actor: { select: { email: true, name: true } },
    },
  });
  return rows;
}
