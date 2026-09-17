import { describe, expect, it } from "vitest";

import {
  hashPassword,
  INVITE_PENDING_HASH,
  isInvitePendingHash,
  isUsablePasswordHash,
  lockedHash,
  verifyPassword,
} from "./password";

describe("password sentinels", () => {
  it("treats !-prefixed hashes as unusable", () => {
    expect(isUsablePasswordHash(INVITE_PENDING_HASH)).toBe(false);
    expect(isUsablePasswordHash(lockedHash())).toBe(false);
    expect(isUsablePasswordHash("$2b$10$abc")).toBe(true);
  });

  it("recognizes the invite-pending sentinel exactly", () => {
    expect(isInvitePendingHash(INVITE_PENDING_HASH)).toBe(true);
    expect(isInvitePendingHash(lockedHash())).toBe(false);
  });
});

describe("hash/verify", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct-horse-9");
    expect(await verifyPassword("correct-horse-9", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("never verifies against a sentinel (no throw)", async () => {
    expect(await verifyPassword("anything", INVITE_PENDING_HASH)).toBe(false);
    expect(await verifyPassword("anything", lockedHash())).toBe(false);
  });
});
