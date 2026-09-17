import { describe, expect, it } from "vitest";

import { GET as meGET } from "@/app/api/v1/auth/me/route";
import { POST as invitePOST } from "@/app/api/v1/team/invite/route";
import { GET as listGET } from "@/app/api/v1/team/members/route";
import { DELETE as deleteMember } from "@/app/api/v1/team/members/[userId]/route";
import { PATCH as rolePATCH } from "@/app/api/v1/team/members/[userId]/role/route";
import { generateApiKey } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  apiRequest,
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
  testEmail,
} from "../helpers";

describe.skipIf(!apiTestsEnabled)("team routes", () => {
  it("any member can list, anonymous cannot", async () => {
    const org = await createTestOrg("team");
    try {
      const res = await listGET(
        await authedRequest("/api/v1/team/members", org.member),
      );
      expect(res.status).toBe(200);
      const emails = ((await res.json()).members as { email: string }[]).map(
        (m) => m.email,
      );
      expect(emails).toContain(org.admin.email);
      expect(emails).toContain(org.member.email);

      const anon = await listGET(apiRequest("/api/v1/team/members"));
      expect(anon.status).toBe(401);
    } finally {
      await org.cleanup();
    }
  });

  it("API keys are never valid for team management (session-only)", async () => {
    const org = await createTestOrg("team");
    try {
      // Even a REAL, valid key must not authenticate a team route.
      const { plaintext, keyHash } = generateApiKey();
      await db.apiKey.create({
        data: {
          orgId: org.orgId,
          userId: org.admin.userId,
          keyHash,
          label: "admin-key",
        },
      });
      const res = await listGET(
        apiRequest("/api/v1/team/members", { apiKey: plaintext }),
      );
      expect(res.status).toBe(401);
    } finally {
      await org.cleanup();
    }
  });

  it("member inviting → 403; admin inviting → 201 with invite link", async () => {
    const org = await createTestOrg("team");
    try {
      const forbidden = await invitePOST(
        await authedRequest("/api/v1/team/invite", org.member, {
          method: "POST",
          body: { email: testEmail("x") },
        }),
      );
      expect(forbidden.status).toBe(403);

      const email = testEmail("newbie");
      const ok = await invitePOST(
        await authedRequest("/api/v1/team/invite", org.admin, {
          method: "POST",
          body: { email },
        }),
      );
      expect(ok.status).toBe(201);
      const body = await ok.json();
      expect(body.user.email).toBe(email);
      expect(body.user.role).toBe("MEMBER");
      expect(body.inviteUrl).toMatch(/^\/invite\//);

      // Duplicate email → 409.
      const dup = await invitePOST(
        await authedRequest("/api/v1/team/invite", org.admin, {
          method: "POST",
          body: { email },
        }),
      );
      expect(dup.status).toBe(409);
    } finally {
      await org.cleanup();
    }
  });

  it("promote/demote round-trips; last super admin is protected", async () => {
    const org = await createTestOrg("team");
    try {
      const promote = await rolePATCH(
        await authedRequest(
          `/api/v1/team/members/${org.member.userId}/role`,
          org.admin,
          { method: "PATCH", body: { role: "SUPER_ADMIN" } },
        ),
        { params: Promise.resolve({ userId: org.member.userId }) },
      );
      expect(promote.status).toBe(200);
      expect((await promote.json()).user.role).toBe("SUPER_ADMIN");

      // Now two admins — demoting the original admin is fine.
      const demote = await rolePATCH(
        await authedRequest(
          `/api/v1/team/members/${org.admin.userId}/role`,
          org.member,
          { method: "PATCH", body: { role: "MEMBER" } },
        ),
        { params: Promise.resolve({ userId: org.admin.userId }) },
      );
      expect(demote.status).toBe(200);

      // ...but demoting the LAST remaining admin is 409.
      const last = await rolePATCH(
        await authedRequest(
          `/api/v1/team/members/${org.member.userId}/role`,
          org.member,
          { method: "PATCH", body: { role: "MEMBER" } },
        ),
        { params: Promise.resolve({ userId: org.member.userId }) },
      );
      expect(last.status).toBe(409);

      // A stale super-admin cookie does not survive demotion: org.admin's JWT
      // still claims SUPER_ADMIN, but the live role is MEMBER → 403.
      const stale = await rolePATCH(
        await authedRequest(
          `/api/v1/team/members/${org.member.userId}/role`,
          org.admin,
          { method: "PATCH", body: { role: "MEMBER" } },
        ),
        { params: Promise.resolve({ userId: org.member.userId }) },
      );
      expect(stale.status).toBe(403);

      // /me reflects the live role, not the stale cookie.
      const me = await meGET(await authedRequest("/x", org.admin));
      expect((await me.json()).user.role).toBe("MEMBER");
    } finally {
      await org.cleanup();
    }
  });

  it("deactivate locks the account, revokes keys, keeps runs", async () => {
    const org = await createTestOrg("team");
    try {
      // Give the member a key + a run first.
      const key = await db.apiKey.create({
        data: {
          orgId: org.orgId,
          userId: org.member.userId,
          keyHash: ` deactivate-${Math.random()}`,
          label: "member-key",
        },
      });
      const project = await db.project.create({
        data: { orgId: org.orgId, slug: "p1", name: "p1" },
      });
      await db.run.create({
        data: {
          projectId: project.id,
          name: "r1",
          createdById: org.member.userId,
        },
      });

      const res = await deleteMember(
        await authedRequest(
          `/api/v1/team/members/${org.member.userId}`,
          org.admin,
          { method: "DELETE" },
        ),
        { params: Promise.resolve({ userId: org.member.userId }) },
      );
      expect(res.status).toBe(200);

      const row = await db.user.findUnique({
        where: { id: org.member.userId },
      });
      expect(row).not.toBeNull(); // row kept for attribution
      expect(row!.passwordHash.startsWith("!")).toBe(true);
      const revoked = await db.apiKey.findUnique({ where: { id: key.id } });
      expect(revoked!.revokedAt).not.toBeNull();
      // Run still attributed.
      expect(
        await db.run.count({ where: { createdById: org.member.userId } }),
      ).toBe(1);

      // Self-deactivation → 409.
      const self = await deleteMember(
        await authedRequest(
          `/api/v1/team/members/${org.admin.userId}`,
          org.admin,
          { method: "DELETE" },
        ),
        { params: Promise.resolve({ userId: org.admin.userId }) },
      );
      expect(self.status).toBe(409);
    } finally {
      await org.cleanup();
    }
  });

  it("cross-org member access → 404", async () => {
    const a = await createTestOrg("teamA");
    const b = await createTestOrg("teamB");
    try {
      const res = await rolePATCH(
        await authedRequest(
          `/api/v1/team/members/${b.member.userId}/role`,
          a.admin,
          { method: "PATCH", body: { role: "SUPER_ADMIN" } },
        ),
        { params: Promise.resolve({ userId: b.member.userId }) },
      );
      expect(res.status).toBe(404);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });
});
