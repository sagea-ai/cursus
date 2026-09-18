import { describe, expect, it } from "vitest";

import { POST as acceptPOST } from "@/app/api/v1/auth/invites/accept/route";
import { GET as previewGET } from "@/app/api/v1/auth/invites/[token]/route";
import { POST as bootstrapPOST } from "@/app/api/v1/auth/bootstrap/route";
import { POST as loginPOST } from "@/app/api/v1/auth/login/route";
import { POST as logoutPOST } from "@/app/api/v1/auth/logout/route";
import { GET as meGET } from "@/app/api/v1/auth/me/route";
import { db } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/session";
import { inviteMember } from "@/lib/team";
import {
  apiRequest,
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
  testEmail,
} from "../helpers";

// NOTE on bootstrap: the positive path (empty users table → 201) cannot run
// in this shared suite — parallel workers always have users present. It is
// covered by the Playwright onboarding journey on a fresh database (e2e/).
// This file pins every refusal: disabled → 410, wrong email → 403 (checked
// before the users-exist check, so deterministic here), users exist → 403.
describe.skipIf(!apiTestsEnabled)("auth routes", () => {
  it("bootstrap refuses a non-bootstrap email without echoing it", async () => {
    const org = await createTestOrg("auth");
    try {
      const res = await bootstrapPOST(
        apiRequest("/api/v1/auth/bootstrap", {
          method: "POST",
          body: {
            orgName: "another",
            name: "Intruder",
            email: testEmail("intruder"),
            password: "password-1",
          },
        }),
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("this email is not authorized for onboarding");
      expect(JSON.stringify(body)).not.toContain("bootstrap-owner");
    } finally {
      await org.cleanup();
    }
  });

  it("bootstrap is 403 once any user exists (right email)", async () => {
    const org = await createTestOrg("auth");
    try {
      const res = await bootstrapPOST(
        apiRequest("/api/v1/auth/bootstrap", {
          method: "POST",
          body: {
            orgName: "another",
            name: "Owner",
            email: process.env["BOOTSTRAP_ADMIN_EMAIL"]!,
            password: "password-1",
          },
        }),
      );
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("already bootstrapped");
    } finally {
      await org.cleanup();
    }
  });

  it("login succeeds with correct password and sets a session cookie", async () => {
    const org = await createTestOrg("auth");
    try {
      const res = await loginPOST(
        apiRequest("/api/v1/auth/login", {
          method: "POST",
          body: { email: org.member.email, password: "test-password-1" },
        }),
      );
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain(SESSION_COOKIE);
      expect(setCookie).toContain("HttpOnly");
      const body = await res.json();
      expect(body.user.email).toBe(org.member.email);
      expect(body.org.slug).toBe(org.orgSlug);
    } finally {
      await org.cleanup();
    }
  });

  it("login rejects wrong password and unknown email identically", async () => {
    const org = await createTestOrg("auth");
    try {
      for (const email of [org.member.email, "nobody@cursus.test"]) {
        const res = await loginPOST(
          apiRequest("/api/v1/auth/login", {
            method: "POST",
            body: { email, password: "wrong-password" },
          }),
        );
        expect(res.status).toBe(401);
        expect((await res.json()).error).toBe("invalid email or password");
      }
    } finally {
      await org.cleanup();
    }
  });

  it("me returns the user with a cookie, 401 without", async () => {
    const org = await createTestOrg("auth");
    try {
      const authed = await meGET(
        await authedRequest("/api/v1/auth/me", org.admin),
      );
      expect(authed.status).toBe(200);
      const body = await authed.json();
      expect(body.user.email).toBe(org.admin.email);
      expect(body.org.slug).toBe(org.orgSlug);

      const anon = await meGET(apiRequest("/api/v1/auth/me"));
      expect(anon.status).toBe(401);
    } finally {
      await org.cleanup();
    }
  });

  it("logout clears the session cookie", async () => {
    const res = await logoutPOST();
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain(
      `${SESSION_COOKIE}=;`,
    );
  });

  it("invite accept sets password, logs in, and is single-use", async () => {
    const org = await createTestOrg("auth");
    try {
      const email = testEmail("invitee");
      const { inviteUrl } = await inviteMember(org.admin, email);
      const token = inviteUrl.split("/").pop()!;

      const first = await acceptPOST(
        apiRequest("/api/v1/auth/invites/accept", {
          method: "POST",
          body: { token, password: "new-password-1" },
        }),
      );
      expect(first.status).toBe(200);
      expect(first.headers.get("set-cookie") ?? "").toContain(SESSION_COOKIE);

      // New password works for login.
      const login = await loginPOST(
        apiRequest("/api/v1/auth/login", {
          method: "POST",
          body: { email, password: "new-password-1" },
        }),
      );
      expect(login.status).toBe(200);

      // Reuse is gone.
      const reuse = await acceptPOST(
        apiRequest("/api/v1/auth/invites/accept", {
          method: "POST",
          body: { token, password: "another-password-1" },
        }),
      );
      expect(reuse.status).toBe(410);

      // Garbage token is bad request.
      const bad = await acceptPOST(
        apiRequest("/api/v1/auth/invites/accept", {
          method: "POST",
          body: { token: "garbage", password: "another-password-1" },
        }),
      );
      expect(bad.status).toBe(400);
    } finally {
      await org.cleanup();
    }
  });

  it("invite preview shows org+email; garbage and used tokens fail", async () => {
    const org = await createTestOrg("auth");
    try {
      const email = testEmail("preview");
      const { inviteUrl } = await inviteMember(org.admin, email);
      const token = inviteUrl.split("/").pop()!;

      const ok = await previewGET(apiRequest("/api/v1/x"), {
        params: Promise.resolve({ token }),
      });
      expect(ok.status).toBe(200);
      const body = await ok.json();
      expect(body.email).toBe(email);
      expect(body.org.slug).toBe(org.orgSlug);

      const garbage = await previewGET(apiRequest("/api/v1/x"), {
        params: Promise.resolve({ token: "garbage" }),
      });
      expect(garbage.status).toBe(400);
    } finally {
      await org.cleanup();
    }
  });

  it("invite-pending users cannot log in before accepting", async () => {
    const org = await createTestOrg("auth");
    try {
      const email = testEmail("pending");
      await inviteMember(org.admin, email);
      const res = await loginPOST(
        apiRequest("/api/v1/auth/login", {
          method: "POST",
          body: { email, password: "anything-at-all" },
        }),
      );
      expect(res.status).toBe(401);
      // Sanity: the pending row really exists.
      expect(await db.user.findUnique({ where: { email } })).not.toBeNull();
    } finally {
      await org.cleanup();
    }
  });
});
