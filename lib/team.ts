import { AuthError, requireRole, type Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/http";
import {
  hashPassword,
  INVITE_PENDING_HASH,
  isInvitePendingHash,
  lockedHash,
  verifyPassword,
} from "@/lib/password";
import { slugify } from "@/lib/runs";
import {
  signInviteToken,
  verifyInviteToken,
  type InviteClaims,
} from "@/lib/session";
import type {
  AcceptInviteInput,
  BootstrapInput,
  LoginInput,
} from "@/lib/validation";

// User/org/team service. Route handlers stay thin
// (session → validate → call service → return); role checks go through
// requireRole() only (§5.2), never inline comparisons.

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Session["role"];
  createdAt: Date;
}

function toPublicUser(u: {
  id: string;
  email: string;
  name: string;
  role: Session["role"];
  createdAt: Date;
}): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt,
  };
}

export interface OrgRef {
  id: string;
  slug: string;
  name: string;
}

async function orgRef(orgId: string): Promise<OrgRef> {
  const org = await db.org.findUnique({ where: { id: orgId } });
  if (!org) throw new ApiError(404, "org not found");
  return { id: org.id, slug: org.slug, name: org.name };
}

async function uniqueOrgSlug(base: string): Promise<string> {
  let slug = slugify(base) || "org";
  for (let i = 0; i < 5; i++) {
    const existing = await db.org.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!existing) return slug;
    slug = `${slugify(base) || "org"}-${Math.random().toString(36).slice(2, 6)}`;
  }
  throw new ApiError(409, "could not allocate an org slug, retry");
}

/** First-boot provisioning (docs/prd-onboarding.md): gated, one-time.
 * Checks run in an order that keeps every refusal deterministic: flag →
 * env configured → email match → empty DB. In particular the email gate
 * precedes the users-exist check, so a wrong email is always 403 even on
 * a live instance (and the expected address is never echoed).
 */
export async function bootstrapOrg(input: BootstrapInput): Promise<{
  org: { id: string; slug: string; name: string };
  user: PublicUser;
}> {
  const settings = await db.globalSettings.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global" },
  });
  if (settings.onboardingDisabled) {
    throw new ApiError(410, "onboarding is permanently disabled");
  }
  const allowed = process.env["BOOTSTRAP_ADMIN_EMAIL"]?.trim().toLowerCase();
  if (!allowed) {
    throw new ApiError(
      500,
      "onboarding is not configured (BOOTSTRAP_ADMIN_EMAIL is not set)",
    );
  }
  if (input.email.trim().toLowerCase() !== allowed) {
    throw new AuthError(403, "this email is not authorized for onboarding");
  }
  const count = await db.user.count();
  if (count > 0) throw new ApiError(403, "already bootstrapped");
  const slug = await uniqueOrgSlug(input.orgName);
  try {
    const org = await db.org.create({
      data: { name: input.orgName, slug },
    });
    const user = await db.user.create({
      data: {
        orgId: org.id,
        email: input.email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
        role: "SUPER_ADMIN",
      },
    });
    // Close onboarding in the same flow that creates the first account.
    await db.globalSettings.update({
      where: { id: "global" },
      data: { onboardingDisabled: true },
    });
    return {
      org: { id: org.id, slug: org.slug, name: org.name },
      user: toPublicUser(user),
    };
  } catch (e) {
    // Double-submit race: the loser's unique-email insert lands here.
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "P2002"
    ) {
      throw new ApiError(403, "already bootstrapped");
    }
    throw e;
  }
}

export async function loginUser(
  input: LoginInput,
): Promise<{ session: Session; user: PublicUser; org: OrgRef }> {
  const user = await db.user.findUnique({ where: { email: input.email } });
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    // Same message either way — no user-enumeration oracle.
    throw new AuthError(401, "invalid email or password");
  }
  const session: Session = {
    userId: user.id,
    orgId: user.orgId,
    email: user.email,
    role: user.role,
  };
  return { session, user: toPublicUser(user), org: await orgRef(user.orgId) };
}

export async function acceptInvite(
  input: AcceptInviteInput,
): Promise<{ session: Session; user: PublicUser; org: OrgRef }> {
  const claims: InviteClaims | null = await verifyInviteToken(input.token);
  if (!claims) throw new ApiError(400, "invalid or expired invite");
  const user = await db.user.findUnique({ where: { id: claims.userId } });
  // Single-use: the token is only valid while the account is still pending —
  // enforced ATOMICALLY by the conditional update below, so two concurrent
  // accepts can't both win (loser gets P2025 → 410).
  if (!user || !isInvitePendingHash(user.passwordHash)) {
    throw new ApiError(410, "invite already used or revoked");
  }
  if (user.email !== claims.email || user.orgId !== claims.orgId) {
    throw new ApiError(400, "invite does not match this account");
  }
  let updated;
  try {
    updated = await db.user.update({
      where: { id: user.id, passwordHash: INVITE_PENDING_HASH },
      data: { passwordHash: await hashPassword(input.password) },
    });
  } catch (e) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "P2025"
    ) {
      throw new ApiError(410, "invite already used or revoked");
    }
    throw e;
  }
  const session: Session = {
    userId: updated.id,
    orgId: updated.orgId,
    email: updated.email,
    role: updated.role,
  };
  return {
    session,
    user: toPublicUser(updated),
    org: await orgRef(updated.orgId),
  };
}

/** Public invite preview for the accept page (token IS the auth). */
export async function previewInvite(
  token: string,
): Promise<{ email: string; org: OrgRef; valid: true }> {
  const claims = await verifyInviteToken(token);
  if (!claims) throw new ApiError(400, "invalid or expired invite");
  const user = await db.user.findUnique({ where: { id: claims.userId } });
  if (!user || !isInvitePendingHash(user.passwordHash)) {
    throw new ApiError(410, "invite already used or revoked");
  }
  return { email: user.email, org: await orgRef(user.orgId), valid: true };
}

export async function listMembers(
  session: Session | null,
): Promise<PublicUser[]> {
  requireRole(session, "MEMBER");
  const users = await db.user.findMany({
    where: { orgId: session.orgId },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
  return users.map(toPublicUser);
}

export async function inviteMember(
  session: Session | null,
  email: string,
): Promise<{ user: PublicUser; inviteUrl: string }> {
  requireRole(session, "SUPER_ADMIN");
  const existing = await db.user.findUnique({ where: { email } });
  // Emails are globally unique: 409 reveals address existence to a super
  // admin. Accepted v1 tradeoff — emails are identifiers, not secrets, and
  // the message is identical whether the address is in-org or elsewhere.
  if (existing) {
    throw new ApiError(409, "email already registered");
  }
  const user = await db.user.create({
    data: {
      orgId: session.orgId,
      email,
      passwordHash: INVITE_PENDING_HASH,
      role: "MEMBER",
    },
  });
  const token = await signInviteToken({
    userId: user.id,
    orgId: session.orgId,
    email,
  });
  // v1: no email infra — the link is shown to the admin to copy/send (§5.3).
  return { user: toPublicUser(user), inviteUrl: `/invite/${token}` };
}

async function memberInOrg(orgId: string, userId: string) {
  const user = await db.user.findFirst({
    where: { id: userId, orgId },
  });
  if (!user) throw new ApiError(404, "member not found");
  return user;
}

export async function setMemberRole(
  session: Session | null,
  targetUserId: string,
  role: Session["role"],
): Promise<PublicUser> {
  requireRole(session, "SUPER_ADMIN");
  const target = await memberInOrg(session.orgId, targetUserId);
  if (target.role === role) return toPublicUser(target);
  if (role === "MEMBER" && target.role === "SUPER_ADMIN") {
    const admins = await db.user.count({
      where: { orgId: session.orgId, role: "SUPER_ADMIN" },
    });
    // Always keep at least one super admin (§5.1).
    if (admins <= 1) {
      throw new ApiError(409, "cannot demote the last super admin");
    }
  }
  const updated = await db.user.update({
    where: { id: target.id },
    data: { role },
  });
  return toPublicUser(updated);
}

/** Deactivate: lock the account + revoke keys, keep the row for attribution.
 * One-way in v1: promoting a locked account does NOT unlock it (the sentinel
 * survives role changes, and locked hashes fail every guard) — there is no
 * reactivation path short of direct DB access. Deactivation is deliberate and
 * confirmed in the UI, so this is a safety property, not a gap.
 */
export async function deactivateMember(
  session: Session | null,
  targetUserId: string,
): Promise<{ id: string }> {
  requireRole(session, "SUPER_ADMIN");
  const target = await memberInOrg(session.orgId, targetUserId);
  if (target.id === session.userId) {
    throw new ApiError(409, "cannot deactivate yourself");
  }
  if (target.role === "SUPER_ADMIN") {
    const admins = await db.user.count({
      where: { orgId: session.orgId, role: "SUPER_ADMIN" },
    });
    if (admins <= 1) {
      throw new ApiError(409, "cannot deactivate the last super admin");
    }
  }
  await db.$transaction([
    db.user.update({
      where: { id: target.id },
      data: { role: "MEMBER", passwordHash: lockedHash() },
    }),
    db.apiKey.updateMany({
      where: { userId: target.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  return { id: target.id };
}
