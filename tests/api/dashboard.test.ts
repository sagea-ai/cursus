import { describe, expect, it } from "vitest";

import { POST as runsPOST } from "@/app/api/v1/runs/route";
import { POST as logPOST } from "@/app/api/v1/runs/[runId]/log/route";
import { POST as finishPOST } from "@/app/api/v1/runs/[runId]/finish/route";
import { POST as groupsPOST } from "@/app/api/v1/groups/route";
import { POST as addMemberPOST } from "@/app/api/v1/groups/[slug]/members/route";
import { POST as createProjectPOST } from "@/app/api/v1/orgs/[orgSlug]/projects/route";
import { POST as invitePOST } from "@/app/api/v1/team/invite/route";
import { db } from "@/lib/db";
import { acceptInvite, inviteMember } from "@/lib/team";
import { signInviteToken } from "@/lib/session";
import { getDashboardStats } from "@/lib/dashboard";
import type { Session } from "@/lib/auth";
import {
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
  testEmail,
} from "../helpers";

async function setup() {
  const org = await createTestOrg("dash");
  const email = testEmail("third-dash");
  const invited = await inviteMember(org.admin, email);
  const token = await signInviteToken({
    userId: invited.user.id,
    orgId: org.orgId,
    email,
  });
  await acceptInvite({ token, password: "Test-password-1" });
  const row = await db.user.findUniqueOrThrow({ where: { email } });
  const stranger: Session = {
    userId: row.id,
    orgId: org.orgId,
    email,
    role: "MEMBER",
  };
  return { ...org, stranger };
}

async function logRun(
  session: Session,
  project: string,
  name: string,
  group?: string,
): Promise<string> {
  const made = await runsPOST(
    await authedRequest("/api/v1/runs", session, {
      method: "POST",
      body: { project, name, ...(group ? { group } : {}) },
    }),
  );
  expect(made.status).toBe(201);
  return ((await made.json()) as { run_id: string }).run_id;
}

describe.skipIf(!apiTestsEnabled)("dashboard stats", () => {
  // DB-heavy: ten scoped aggregates against a real Postgres.
  it("scopes every number by visibility", { timeout: 60_000 }, async () => {
    const org = await setup();
    try {
      await groupsPOST(
        await authedRequest("/api/v1/groups", org.admin, {
          method: "POST",
          body: { name: "G" },
        }),
      );
      await addMemberPOST(
        await authedRequest("/api/v1/groups/g/members", org.admin, {
          method: "POST",
          body: { email: org.member.email },
        }),
        { params: Promise.resolve({ slug: "g" }) },
      );
      await createProjectPOST(
        await authedRequest(
          `/api/v1/orgs/${org.orgSlug}/projects`,
          org.member,
          {
            method: "POST",
            body: { name: "Grouped", group: "g" },
          },
        ),
        { params: Promise.resolve({ orgSlug: org.orgSlug }) },
      );
      // Org-wide finished run + grouped running run, both by member.
      const finished = await logRun(org.member, "open-proj", "done-run");
      await logPOST(
        await authedRequest(`/api/v1/runs/${finished}/log`, org.member, {
          method: "POST",
          body: { points: [{ key: "k", step: 0, value: 1 }] },
        }),
        { params: Promise.resolve({ runId: finished }) },
      );
      await finishPOST(
        await authedRequest(`/api/v1/runs/${finished}/finish`, org.member, {
          method: "POST",
          body: { status: "finished" },
        }),
        { params: Promise.resolve({ runId: finished }) },
      );
      await logRun(org.member, "grouped", "live-run", "g");
      // One pending invite for the admin widget.
      await invitePOST(
        await authedRequest("/api/v1/team/invite", org.admin, {
          method: "POST",
          body: { email: testEmail("pending-dash") },
        }),
      );

      const member = await getDashboardStats(org.member);
      expect(member.totalRuns).toBe(2);
      expect(member.runningNow).toBe(1);
      expect(member.projectCount).toBe(2);
      expect(member.groupCount).toBe(1);
      expect(member.totalComputeMs).toBeGreaterThanOrEqual(0);
      expect(member.activity.reduce((a, d) => a + d.count, 0)).toBe(2);
      expect(member.recentRuns).toHaveLength(2);
      expect(member.pendingInvites).toBe(0);
      // New widgets respect the same visibility scope.
      expect(member.memberCount).toBe(0);
      expect(member.statusMix.reduce((a, s) => a + s.count, 0)).toBe(2);
      expect(member.topProjects.map((p) => p.slug).sort()).toEqual([
        "grouped",
        "open-proj",
      ]);

      const stranger = await getDashboardStats(org.stranger);
      expect(stranger.totalRuns).toBe(1);
      expect(stranger.runningNow).toBe(0);
      expect(stranger.projectCount).toBe(1);
      expect(stranger.groupCount).toBe(0);
      expect(stranger.recentRuns).toHaveLength(1);
      expect(stranger.activity.reduce((a, d) => a + d.count, 0)).toBe(1);
      expect(stranger.topProjects.map((p) => p.slug)).toEqual(["open-proj"]);

      const admin = await getDashboardStats(org.admin);
      expect(admin.totalRuns).toBe(2);
      expect(admin.projectCount).toBe(2);
      expect(admin.pendingInvites).toBe(1);
      expect(admin.memberCount).toBeGreaterThanOrEqual(3);
      expect(admin.groupCount).toBe(1);

      // Crashed-run attention: crash the grouped run, stranger sees none.
      await finishPOST(
        await authedRequest(`/api/v1/runs/${finished}/finish`, org.member, {
          method: "POST",
          body: { status: "finished" },
        }),
        { params: Promise.resolve({ runId: finished }) },
      );
      const crashable = await logRun(org.member, "grouped", "doomed", "g");
      await finishPOST(
        await authedRequest(`/api/v1/runs/${crashable}/finish`, org.member, {
          method: "POST",
          body: { status: "crashed" },
        }),
        { params: Promise.resolve({ runId: crashable }) },
      );
      const afterMember = await getDashboardStats(org.member);
      expect(afterMember.crashedWeek.map((r) => r.name)).toContain("doomed");
      const afterStranger = await getDashboardStats(org.stranger);
      expect(afterStranger.crashedWeek).toHaveLength(0);
    } finally {
      await org.cleanup();
    }
  });

  it("requires authentication", async () => {
    await expect(getDashboardStats(null)).rejects.toThrow();
  });
});
