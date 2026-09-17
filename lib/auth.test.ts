import { describe, expect, it } from "vitest";

import {
  AuthError,
  generateApiKey,
  hashApiKey,
  isApiKeyFormat,
  requireAuth,
  requireRole,
  type Session,
} from "./auth";

const member: Session = {
  userId: "u1",
  orgId: "o1",
  email: "m@example.com",
  role: "MEMBER",
};

const admin: Session = {
  userId: "u2",
  orgId: "o1",
  email: "a@example.com",
  role: "SUPER_ADMIN",
};

describe("requireAuth / requireRole", () => {
  it("throws 401 for null session", () => {
    expect(() => requireAuth(null)).toThrowError(AuthError);
    try {
      requireRole(null, "MEMBER");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).status).toBe(401);
    }
  });

  it("allows any authenticated user for MEMBER baseline", () => {
    expect(() => requireRole(member, "MEMBER")).not.toThrow();
    expect(() => requireRole(admin, "MEMBER")).not.toThrow();
  });

  it("throws 403 when a member hits a super-admin route", () => {
    try {
      requireRole(member, "SUPER_ADMIN");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).status).toBe(403);
    }
  });

  it("allows super admins through the super-admin guard", () => {
    expect(() => requireRole(admin, "SUPER_ADMIN")).not.toThrow();
  });
});

describe("API key hashing", () => {
  it("generates a prefixed key whose hash verifies", () => {
    const { plaintext, keyHash } = generateApiKey();
    expect(isApiKeyFormat(plaintext)).toBe(true);
    expect(hashApiKey(plaintext)).toBe(keyHash);
  });

  it("rejects non-key strings", () => {
    expect(isApiKeyFormat("not-a-key")).toBe(false);
  });
});
