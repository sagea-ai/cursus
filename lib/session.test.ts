import * as jose from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import type { Session } from "./auth";
import {
  signInviteToken,
  signSession,
  verifyInviteToken,
  verifySessionToken,
} from "./session";

beforeEach(() => {
  process.env["SESSION_SECRET"] = "test-secret-for-unit-tests-only";
});

const session: Session = {
  userId: "u1",
  orgId: "o1",
  email: "a@example.com",
  role: "SUPER_ADMIN",
};

describe("session tokens", () => {
  it("round-trips through sign/verify", async () => {
    expect(await verifySessionToken(await signSession(session))).toEqual(
      session,
    );
  });

  it("rejects tampered tokens", async () => {
    const token = await signSession(session);
    const tampered = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
    expect(await verifySessionToken(tampered)).toBeNull();
  });

  it("rejects expired tokens", async () => {
    const expired = await new jose.SignJWT({ typ: "session" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1s ago")
      .sign(new TextEncoder().encode(process.env["SESSION_SECRET"]));
    expect(await verifySessionToken(expired)).toBeNull();
  });

  it("rejects an invite token used as a session", async () => {
    const invite = await signInviteToken({
      userId: "u1",
      orgId: "o1",
      email: "m@example.com",
    });
    expect(await verifySessionToken(invite)).toBeNull();
  });
});

describe("invite tokens", () => {
  it("round-trips through sign/verify", async () => {
    const claims = { userId: "u9", orgId: "o1", email: "m@example.com" };
    expect(await verifyInviteToken(await signInviteToken(claims))).toEqual(
      claims,
    );
  });

  it("rejects a session token used as an invite", async () => {
    expect(await verifyInviteToken(await signSession(session))).toBeNull();
  });
});
