import * as jose from "jose";
import type { NextResponse } from "next/server";

import type { Session } from "@/lib/auth";

// Stateless session + invite tokens (PRD §5.3, §6).
// - Dashboard sessions: HS256 JWT in an httpOnly cookie. No server-side
//   session table in v1 (one less thing to operate; revocation on password
//   change is a documented v2 gap, not an oversight).
// - Invite tokens: HS256 JWT with typ:"invite", 7-day expiry. Single-use is
//   enforced by checking the user's passwordHash is still the invite-pending
//   sentinel at accept time — no token table needed.

export const SESSION_COOKIE = "cursus_session";
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days
const INVITE_MAX_AGE_S = 60 * 60 * 24 * 7; // 7 days

function secret(): Uint8Array {
  const raw = process.env["SESSION_SECRET"];
  if (!raw) {
    throw new Error(
      "SESSION_SECRET is not set. Copy .env.example to .env and set a random value.",
    );
  }
  return new TextEncoder().encode(raw);
}

export async function signSession(s: Session): Promise<string> {
  return new jose.SignJWT({
    typ: "session",
    uid: s.userId,
    org: s.orgId,
    email: s.email,
    role: s.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_S}s`)
    .sign(secret());
}

export async function verifySessionToken(
  token: string,
): Promise<Session | null> {
  try {
    const { payload } = await jose.jwtVerify(token, secret());
    if (payload["typ"] !== "session") return null;
    const { uid, org, email, role } = payload as Record<string, unknown>;
    if (
      typeof uid !== "string" ||
      typeof org !== "string" ||
      typeof email !== "string" ||
      (role !== "SUPER_ADMIN" && role !== "MEMBER")
    ) {
      return null;
    }
    return { userId: uid, orgId: org, email, role };
  } catch {
    return null;
  }
}

export interface InviteClaims {
  userId: string;
  orgId: string;
  email: string;
}

export async function signInviteToken(c: InviteClaims): Promise<string> {
  return new jose.SignJWT({
    typ: "invite",
    uid: c.userId,
    org: c.orgId,
    email: c.email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${INVITE_MAX_AGE_S}s`)
    .sign(secret());
}

export async function verifyInviteToken(
  token: string,
): Promise<InviteClaims | null> {
  try {
    const { payload } = await jose.jwtVerify(token, secret());
    if (payload["typ"] !== "invite") return null;
    const { uid, org, email } = payload as Record<string, unknown>;
    if (
      typeof uid !== "string" ||
      typeof org !== "string" ||
      typeof email !== "string"
    ) {
      return null;
    }
    return { userId: uid, orgId: org, email };
  } catch {
    return null;
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env["NODE_ENV"] === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  };
}

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, cookieOptions());
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}
