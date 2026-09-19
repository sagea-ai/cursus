import { describe, expect, it } from "vitest";

import { GET as meGET } from "@/app/api/v1/auth/me/route";
import { POST as invitePOST } from "@/app/api/v1/team/invite/route";
import { GET as listGET } from "@/app/api/v1/team/members/route";
import { DELETE as deleteMember } from "@/app/api/v1/team/members/[userId]/route";
import { PATCH as renamePATCH } from "@/app/api/v1/team/members/[userId]/name/route";
import { POST as reactivatePOST } from "@/app/api/v1/team/members/[userId]/reactivate/route";
import { PATCH as rolePATCH } from "@/app/api/v1/team/members/[userId]/role/route";
import { POST as acceptPOST } from "@/app/api/v1/auth/invites/accept/route";
import { POST as deletePOST } from "@/app/api/v1/team/members/[userId]/delete/route";
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

      // The deactivated member's EXISTING session cookie is dead everywhere —
      // locked hashes fail the live-session guard, not just login.
      const deadList = await listGET(
        await authedRequest("/api/v1/team/members", org.member),
      );
      expect(deadList.status).toBe(401);
      const deadMe = await meGET(
        await authedRequest("/api/v1/auth/me", org.member),
      );
      expect(deadMe.status).toBe(401);

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

  it("member list carries active/pending/inactive statuses", async () => {
    const org = await createTestOrg("team");
    try {
      const email = testEmail("pending-status");
      await invitePOST(
        await authedRequest("/api/v1/team/invite", org.admin, {
          method: "POST",
          body: { email },
        }),
      );
      const byEmail = async () => {
        const res = await listGET(
          await authedRequest("/api/v1/team/members", org.admin),
        );
        expect(res.status).toBe(200);
        return new Map(
          (
            (await res.json()).members as {
              email: string;
              status: string;
            }[]
          ).map((m) => [m.email, m.status] as const),
        );
      };
      expect((await byEmail()).get(email)).toBe("pending");
      expect((await byEmail()).get(org.member.email)).toBe("active");

      await deleteMember(
        await authedRequest(
          `/api/v1/team/members/${org.member.userId}`,
          org.admin,
          { method: "DELETE" },
        ),
        { params: Promise.resolve({ userId: org.member.userId }) },
      );
      expect((await byEmail()).get(org.member.email)).toBe("inactive");
    } finally {
      await org.cleanup();
    }
  });

  it("reactivate re-invites inactive members; active → 409; member → 403", async () => {
    const org = await createTestOrg("team");
    try {
      // A live (non-admin) member cannot reactivate a pending invite.
      const pendingEmail = testEmail("pending-re");
      const invited = await invitePOST(
        await authedRequest("/api/v1/team/invite", org.admin, {
          method: "POST",
          body: { email: pendingEmail },
        }),
      );
      const pendingId = ((await invited.json()) as { user: { id: string } })
        .user.id;
      const forbidden = await reactivatePOST(
        await authedRequest(`/api/v1/team/members/${pendingId}`, org.member, {
          method: "POST",
        }),
        { params: Promise.resolve({ userId: pendingId }) },
      );
      expect(forbidden.status).toBe(403);

      await deleteMember(
        await authedRequest(
          `/api/v1/team/members/${org.member.userId}`,
          org.admin,
          { method: "DELETE" },
        ),
        { params: Promise.resolve({ userId: org.member.userId }) },
      );

      // Admin gets a fresh link; account is pending again.
      const res = await reactivatePOST(
        await authedRequest(
          `/api/v1/team/members/${org.member.userId}`,
          org.admin,
          { method: "POST" },
        ),
        { params: Promise.resolve({ userId: org.member.userId }) },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        user: { status: string };
        inviteUrl: string;
      };
      expect(body.user.status).toBe("pending");
      expect(body.inviteUrl).toContain("/invite/");

      // The fresh link accepts with a name claim and restores access.
      const token = body.inviteUrl.split("/").pop()!;
      const accept = await acceptPOST(
        apiRequest("/api/v1/auth/invites/accept", {
          method: "POST",
          body: {
            token,
            password: "Comeback-password-1",
            name: "Returned Member",
          },
        }),
      );
      expect(accept.status).toBe(200);
      expect(
        ((await accept.json()) as { user: { name: string } }).user.name,
      ).toBe("Returned Member");

      // Reactivating an active account → 409.
      const again = await reactivatePOST(
        await authedRequest(
          `/api/v1/team/members/${org.member.userId}`,
          org.admin,
          { method: "POST" },
        ),
        { params: Promise.resolve({ userId: org.member.userId }) },
      );
      expect(again.status).toBe(409);
    } finally {
      await org.cleanup();
    }
  });

  it("admin renames members; member → 403; blank → 400", async () => {
    const org = await createTestOrg("team");
    try {
      const ok = await renamePATCH(
        await authedRequest(
          `/api/v1/team/members/${org.member.userId}/name`,
          org.admin,
          { method: "PATCH", body: { name: "  Renamed Member " } },
        ),
        { params: Promise.resolve({ userId: org.member.userId }) },
      );
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { user: { name: string } }).user.name).toBe(
        "Renamed Member",
      );

      const forbidden = await renamePATCH(
        await authedRequest(
          `/api/v1/team/members/${org.admin.userId}/name`,
          org.member,
          { method: "PATCH", body: { name: "Hacked" } },
        ),
        { params: Promise.resolve({ userId: org.admin.userId }) },
      );
      expect(forbidden.status).toBe(403);

      const blank = await renamePATCH(
        await authedRequest(
          `/api/v1/team/members/${org.member.userId}/name`,
          org.admin,
          { method: "PATCH", body: { name: "   " } },
        ),
        { params: Promise.resolve({ userId: org.member.userId }) },
      );
      expect(blank.status).toBe(400);
    } finally {
      await org.cleanup();
    }
  });

  it("delete removes the row, cascades, reassigns content to the admin", async () => {
    const org = await createTestOrg("team");
    try {
      // Member owns a key, a run, a group membership, and an audit entry.
      const key = await db.apiKey.create({
        data: {
          orgId: org.orgId,
          userId: org.member.userId,
          keyHash: `delete-${Math.random()}`,
          label: "member-key",
        },
      });
      const project = await db.project.create({
        data: { orgId: org.orgId, slug: "pdel", name: "pdel" },
      });
      const run = await db.run.create({
        data: {
          projectId: project.id,
          name: "r-del",
          createdById: org.member.userId,
        },
      });
      const group = await db.group.create({
        data: {
          orgId: org.orgId,
          slug: "gdel",
          name: "gdel",
          createdById: org.member.userId,
        },
      });
      await db.groupMember.create({
        data: { groupId: group.id, userId: org.member.userId },
      });
      await db.auditEvent.create({
        data: {
          orgId: org.orgId,
          actorId: org.member.userId,
          action: "test.action",
          targetType: "test",
        },
      });

      const res = await deletePOST(
        await authedRequest(
          `/api/v1/team/members/${org.member.userId}/delete`,
          org.admin,
          { method: "POST" },
        ),
        { params: Promise.resolve({ userId: org.member.userId }) },
      );
      expect(res.status).toBe(200);

      // Row gone; keys + memberships cascaded.
      expect(
        await db.user.findUnique({ where: { id: org.member.userId } }),
      ).toBeNull();
      expect(await db.apiKey.findUnique({ where: { id: key.id } })).toBeNull();
      expect(
        await db.groupMember.findFirst({
          where: { groupId: group.id, userId: org.member.userId },
        }),
      ).toBeNull();
      // Content survives, reassigned to the acting admin.
      expect(
        (await db.run.findUniqueOrThrow({ where: { id: run.id } })).createdById,
      ).toBe(org.admin.userId);
      expect(
        (await db.group.findUniqueOrThrow({ where: { id: group.id } }))
          .createdById,
      ).toBe(org.admin.userId);
      expect(
        await db.auditEvent.count({
          where: { actorId: org.member.userId },
        }),
      ).toBe(0);

      // Deleted cookie is dead.
      const dead = await listGET(
        await authedRequest("/api/v1/team/members", org.member),
      );
      expect(dead.status).toBe(401);

      // Self-delete → 409.
      const self = await deletePOST(
        await authedRequest(
          `/api/v1/team/members/${org.admin.userId}/delete`,
          org.admin,
          { method: "POST" },
        ),
        { params: Promise.resolve({ userId: org.admin.userId }) },
      );
      expect(self.status).toBe(409);
    } finally {
      await org.cleanup();
    }
  });

  it("delete: member → 403; cross-org → 404", async () => {
    const a = await createTestOrg("teamA");
    const b = await createTestOrg("teamB");
    try {
      const forbidden = await deletePOST(
        await authedRequest(
          `/api/v1/team/members/${a.admin.userId}/delete`,
          a.member,
          { method: "POST" },
        ),
        { params: Promise.resolve({ userId: a.admin.userId }) },
      );
      expect(forbidden.status).toBe(403);

      const cross = await deletePOST(
        await authedRequest(
          `/api/v1/team/members/${b.member.userId}/delete`,
          a.admin,
          { method: "POST" },
        ),
        { params: Promise.resolve({ userId: b.member.userId }) },
      );
      expect(cross.status).toBe(404);
    } finally {
      await a.cleanup();
      await b.cleanup();
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
