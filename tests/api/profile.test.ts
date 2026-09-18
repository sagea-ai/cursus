import { describe, expect, it } from "vitest";

import {
  GET as profileGET,
  PATCH as profilePATCH,
} from "@/app/api/v1/profile/route";
import { GET as activityGET } from "@/app/api/v1/profile/activity/route";
import { GET as runsGET } from "@/app/api/v1/profile/runs/route";
import { POST as runsPOST } from "@/app/api/v1/runs/route";
import { POST as groupsPOST } from "@/app/api/v1/groups/route";
import { POST as addMemberPOST } from "@/app/api/v1/groups/[slug]/members/route";
import { DELETE as removeMemberDELETE } from "@/app/api/v1/groups/[slug]/members/[userId]/route";
import { db } from "@/lib/db";
import {
  apiRequest,
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
} from "../helpers";

describe.skipIf(!apiTestsEnabled)("profile routes", () => {
  it("reads own profile; anonymous → 401", async () => {
    const org = await createTestOrg("prof");
    try {
      const res = await profileGET(
        await authedRequest("/api/v1/profile", org.member),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        user: { email: string; bio: string; org: { slug: string } };
      };
      expect(body.user.email).toBe(org.member.email);
      expect(body.user.bio).toBe("");
      expect(body.user.org.slug).toBe(org.orgSlug);

      const anon = await profileGET(apiRequest("/api/v1/profile"));
      expect(anon.status).toBe(401);
    } finally {
      await org.cleanup();
    }
  });

  it("updates bio/location/website/handles; email and name are immutable", async () => {
    const org = await createTestOrg("prof");
    try {
      const res = await profilePATCH(
        await authedRequest("/api/v1/profile", org.member, {
          method: "PATCH",
          body: {
            bio: "trains things",
            location: "KTM",
            website: "https://example.com",
            twitter: "@handle",
            github: "@octo",
            email: "hacker@cursus.test",
            name: "Hacker",
          },
        }),
      );
      expect(res.status).toBe(200);
      const user = (await res.json()).user as {
        bio: string;
        twitter: string;
        github: string;
        email: string;
        name: string;
      };
      expect(user.bio).toBe("trains things");
      expect(user.twitter).toBe("handle");
      expect(user.github).toBe("octo");
      // Stripped + untouched — no code path writes them here.
      expect(user.email).toBe(org.member.email);
      const row = await db.user.findUniqueOrThrow({
        where: { id: org.member.userId },
      });
      expect(row.email).toBe(org.member.email);
      expect(row.name).toBe("");

      const empty = await profilePATCH(
        await authedRequest("/api/v1/profile", org.member, {
          method: "PATCH",
          body: {},
        }),
      );
      expect(empty.status).toBe(400);
    } finally {
      await org.cleanup();
    }
  });

  it("activity buckets own runs by day; hidden runs stop counting", async () => {
    const org = await createTestOrg("prof");
    try {
      const ago = (days: number) =>
        new Date(Date.now() - days * 86_400_000).toISOString();
      const mk = async (project: string, name: string, startedAt: string) => {
        const made = await runsPOST(
          await authedRequest("/api/v1/runs", org.member, {
            method: "POST",
            body: { project, name },
          }),
        );
        const runId = ((await made.json()) as { run_id: string }).run_id;
        await db.run.update({
          where: { id: runId },
          data: { startedAt: new Date(startedAt) },
        });
        return runId;
      };
      await mk("p", "two-days-ago", ago(2));
      await mk("p", "today", ago(0));

      const res = await activityGET(
        await authedRequest("/api/v1/profile/activity", org.member),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        total: number;
        days: { date: string; count: number }[];
      };
      expect(body.days).toHaveLength(365);
      expect(body.total).toBe(2);
      const byDate = Object.fromEntries(
        body.days.map((d) => [d.date, d.count]),
      );
      expect(byDate[ago(2).slice(0, 10)]).toBe(1);
      expect(byDate[ago(0).slice(0, 10)]).toBe(1);

      // Move today's run into a group the member then leaves: the day
      // goes dark for them (visibility applies to activity too).
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
      await db.project.update({
        where: { orgId_slug: { orgId: org.orgId, slug: "p" } },
        data: {
          groupId: (
            await db.group.findUniqueOrThrow({
              where: { orgId_slug: { orgId: org.orgId, slug: "g" } },
            })
          ).id,
        },
      });
      const after = (await (
        await activityGET(
          await authedRequest("/api/v1/profile/activity", org.member),
        )
      ).json()) as { total: number };
      expect(after.total).toBe(2);

      await removeMemberDELETE(
        await authedRequest(
          `/api/v1/groups/g/members/${org.member.userId}`,
          org.admin,
          { method: "DELETE" },
        ),
        { params: Promise.resolve({ slug: "g", userId: org.member.userId }) },
      );
      const gone = (await (
        await activityGET(
          await authedRequest("/api/v1/profile/activity", org.member),
        )
      ).json()) as { total: number };
      expect(gone.total).toBe(0);
    } finally {
      await org.cleanup();
    }
  });

  it("recent runs search, cap, and hide left groups", async () => {
    const org = await createTestOrg("prof");
    try {
      const mk = async (name: string) => {
        const made = await runsPOST(
          await authedRequest("/api/v1/runs", org.member, {
            method: "POST",
            body: { project: "p", name },
          }),
        );
        return ((await made.json()) as { run_id: string }).run_id;
      };
      await mk("alpha-run");
      await mk("beta-run");

      const all = (await (
        await runsGET(await authedRequest("/api/v1/profile/runs", org.member))
      ).json()) as { runs: { name: string }[] };
      expect(all.runs.map((r) => r.name).sort()).toEqual([
        "alpha-run",
        "beta-run",
      ]);

      const searched = (await (
        await runsGET(
          await authedRequest("/api/v1/profile/runs?q=beta", org.member),
        )
      ).json()) as { runs: { name: string }[] };
      expect(searched.runs.map((r) => r.name)).toEqual(["beta-run"]);

      const capped = (await (
        await runsGET(
          await authedRequest("/api/v1/profile/runs?limit=1", org.member),
        )
      ).json()) as { runs: unknown[] };
      expect(capped.runs).toHaveLength(1);

      const anon = await runsGET(apiRequest("/api/v1/profile/runs"));
      expect(anon.status).toBe(401);

      // Group the project, then leave it: own runs vanish from the list.
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
      await db.project.update({
        where: { orgId_slug: { orgId: org.orgId, slug: "p" } },
        data: {
          groupId: (
            await db.group.findUniqueOrThrow({
              where: { orgId_slug: { orgId: org.orgId, slug: "g" } },
            })
          ).id,
        },
      });
      await removeMemberDELETE(
        await authedRequest(
          `/api/v1/groups/g/members/${org.member.userId}`,
          org.admin,
          { method: "DELETE" },
        ),
        { params: Promise.resolve({ slug: "g", userId: org.member.userId }) },
      );
      const hidden = (await (
        await runsGET(await authedRequest("/api/v1/profile/runs", org.member))
      ).json()) as { runs: unknown[] };
      expect(hidden.runs).toHaveLength(0);
    } finally {
      await org.cleanup();
    }
  });
});
