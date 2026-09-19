import bcrypt from "bcryptjs";

// Password hashing + account-state sentinels.
//
// Invite-pending and deactivated accounts are represented WITHOUT a schema
// change: passwordHash holds a "!"-prefixed sentinel that can never verify.
// - "!invite-pending" — user row created by invite, no password set yet.
// - "!locked-<random>" — deactivated user (DELETE /team/members/:id keeps the
//   row so run attribution survives, but the account can never log in).
// - "!sso-<random>" — SSO-only account: no password exists, so password
//   login is impossible, but SSO sessions are fully alive.
// isUsablePasswordHash() is the single check login + accept-invite use;
// isSessionAliveHash() is what session guards use (usable OR sso-only).

const BCRYPT_ROUNDS = 10;

export const INVITE_PENDING_HASH = "!invite-pending";
const LOCKED_PREFIX = "!locked-";
const SSO_PREFIX = "!sso-";

export function isUsablePasswordHash(hash: string): boolean {
  return !hash.startsWith("!");
}

export function isSsoOnlyHash(hash: string): boolean {
  return hash.startsWith(SSO_PREFIX);
}

export function isSessionAliveHash(hash: string): boolean {
  return isUsablePasswordHash(hash) || isSsoOnlyHash(hash);
}

export function isInvitePendingHash(hash: string): boolean {
  return hash === INVITE_PENDING_HASH;
}

export function lockedHash(): string {
  const rand = Math.random().toString(36).slice(2, 14);
  return `${LOCKED_PREFIX}${rand}`;
}

export function ssoOnlyHash(): string {
  const rand = Math.random().toString(36).slice(2, 14);
  return `${SSO_PREFIX}${rand}`;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  if (!isUsablePasswordHash(hash)) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}
