import { describe, expect, it } from "vitest";

import { GET as runGET } from "@/app/api/v1/runs/[runId]/route";
import { POST as logPOST } from "@/app/api/v1/runs/[runId]/log/route";
import { GET as metricsGET } from "@/app/api/v1/runs/[runId]/metrics/route";
import { POST as runsPOST } from "@/app/api/v1/runs/route";
import { GET as exportGET } from "@/app/api/v1/runs/[runId]/export/route";
import { PATCH as runPATCH } from "@/app/api/v1/runs/[runId]/route";
import {
  DELETE as groupDELETE,
  GET as groupGET,
  PATCH as groupPATCH,
} from "@/app/api/v1/groups/[slug]/route";
import {
  POST as groupsPOST,
  GET as groupsGET,
} from "@/app/api/v1/groups/route";
import { POST as addMemberPOST } from "@/app/api/v1/groups/[slug]/members/route";
import { DELETE as removeMemberDELETE } from "@/app/api/v1/groups/[slug]/members/[userId]/route";
import { GET as overviewGET } from "@/app/api/v1/orgs/[orgSlug]/projects/[projectSlug]/route";
import { generateApiKey, hashApiKey } from "@/lib/auth";
import { db } from "@/lib/db";
import { acceptInvite, inviteMember } from "@/lib/team";
import { signInviteToken } from "@/lib/session";
import type { Session } from "@/lib/auth";
import {
  apiRequest,
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
  testEmail,
} from "../helpers";

const slug = (s: string) => ({ params: Promise.resolve({ slug: s }) });

async function threePersonOrg(tag: string) {
  const org = await createTestOrg(tag);
  const email = testEmail(`third-${tag}`);
  const invited = await inviteMember(org.admin, email);
  // Accept the invite so the account is live.
  const token = await signInviteToken({
    userId: invited.user.id,
    orgId: org.orgId,
    email,
  });
  await acceptInvite({ token, password: "password-1" });
  const row = await db.user.findUniqueOrThrow({ where: { email } });
  const third: Session = {
    userId: row.id,
    orgId: org.orgId,
    email,
    role: "MEMBER",
  };
  return { ...org, third };
}

async function makeGroup(
  admin: Session,
  body: Record<string, string>,
  status = 201,
) {
  const res = await groupsPOST(
    await authedRequest("/api/v1/groups", admin, {
      method: "POST",
      body,
    }),
  );
  expect(res.status).toBe(status);
  return res;
}

describe.skipIf(!apiTestsEnabled)("groups", () => {
  it("admin creates; dup → 409; member → 403; anon → 401", async () => {
    const org = await threePersonOrg("grp");
    try {
      const ok = await makeGroup(org.admin, { name: "Vision" });
      expect(((await ok.json()).group as { slug: string }).slug).toBe("vision");
      await makeGroup(org.admin, { name: "Vision" }, 409);

      const member = await groupsPOST(
        await authedRequest("/api/v1/groups", org.member, {
          method: "POST",
          body: { name: "Nope" },
        }),
      );
      expect(member.status).toBe(403);

      const anon = await groupsPOST(
        apiRequest("/api/v1/groups", { method: "POST", body: { name: "X" } }),
      );
      expect(anon.status).toBe(401);
    } finally {
      await org.cleanup();
    }
  });

  it("members list only their groups; detail hides strangers", async () => {
    const org = await threePersonOrg("grp");
    try {
      await makeGroup(org.admin, { name: "G1" });
      await addMemberPOST(
        await authedRequest("/api/v1/groups/g1/members", org.admin, {
          method: "POST",
          body: { email: org.member.email },
        }),
        { params: Promise.resolve({ slug: "g1" }) },
      );

      const mine = (await (
        await groupsGET(await authedRequest("/api/v1/groups", org.member))
      ).json()) as { groups: { slug: string }[] };
      expect(mine.groups.map((g) => g.slug)).toEqual(["g1"]);

      const all = (await (
        await groupsGET(await authedRequest("/api/v1/groups", org.admin))
      ).json()) as { groups: unknown[] };
      expect(all.groups).toHaveLength(1);

      // Stranger gets 404 (slug existence does not leak).
      const stranger = await groupGET(
        await authedRequest("/api/v1/groups/g1", org.third),
        slug("g1"),
      );
      expect(stranger.status).toBe(404);

      // Membership management is admin-only; dupes and strangers 409/404.
      const memberAdd = await addMemberPOST(
        await authedRequest("/api/v1/groups/g1/members", org.member, {
          method: "POST",
          body: { email: org.third.email },
        }),
        { params: Promise.resolve({ slug: "g1" }) },
      );
      expect(memberAdd.status).toBe(403);

      const dup = await addMemberPOST(
        await authedRequest("/api/v1/groups/g1/members", org.admin, {
          method: "POST",
          body: { email: org.member.email },
        }),
        { params: Promise.resolve({ slug: "g1" }) },
      );
      expect(dup.status).toBe(409);

      const ghost = await addMemberPOST(
        await authedRequest("/api/v1/groups/g1/members", org.admin, {
          method: "POST",
          body: { email: "ghost@cursus.test" },
        }),
        { params: Promise.resolve({ slug: "g1" }) },
      );
      expect(ghost.status).toBe(404);

      const removed = await removeMemberDELETE(
        await authedRequest(
          `/api/v1/groups/g1/members/${org.member.userId}`,
          org.admin,
          {
            method: "DELETE",
          },
        ),
        {
          params: Promise.resolve({
            slug: "g1",
            userId: org.member.userId,
          }),
        },
      );
      expect(removed.status).toBe(200);
      const relisted = (await (
        await groupsGET(await authedRequest("/api/v1/groups", org.member))
      ).json()) as { groups: unknown[] };
      expect(relisted.groups).toHaveLength(0);

      const missing = await removeMemberDELETE(
        await authedRequest(
          `/api/v1/groups/g1/members/${org.member.userId}`,
          org.admin,
          {
            method: "DELETE",
          },
        ),
        {
          params: Promise.resolve({
            slug: "g1",
            userId: org.member.userId,
          }),
        },
      );
      expect(missing.status).toBe(404);
    } finally {
      await org.cleanup();
    }
  });

  it("grouped runs are invisible and unwritable to outsiders", async () => {
    const org = await threePersonOrg("grp");
    try {
      await makeGroup(org.admin, { name: "Secret" });
      await addMemberPOST(
        await authedRequest("/api/v1/groups/secret/members", org.admin, {
          method: "POST",
          body: { email: org.member.email },
        }),
        { params: Promise.resolve({ slug: "secret" }) },
      );

      // Member creates a group run; stranger cannot create into it.
      const mk = await runsPOST(
        await authedRequest("/api/v1/runs", org.member, {
          method: "POST",
          body: { project: "p", name: "hidden", group: "secret" },
        }),
      );
      expect(mk.status).toBe(201);
      const runId = ((await mk.json()) as { run_id: string }).run_id;

      const strangerCreate = await runsPOST(
        await authedRequest("/api/v1/runs", org.third, {
          method: "POST",
          body: { project: "p", name: "sneaky", group: "secret" },
        }),
      );
      expect(strangerCreate.status).toBe(403);

      const badGroup = await runsPOST(
        await authedRequest("/api/v1/runs", org.member, {
          method: "POST",
          body: { project: "p", name: "lost", group: "nope" },
        }),
      );
      expect(badGroup.status).toBe(404);

      // Outsider reads: 404 across every surface (no oracle).
      const getRes = await runGET(
        await authedRequest(`/api/v1/runs/${runId}`, org.third),
        { params: Promise.resolve({ runId }) },
      );
      expect(getRes.status).toBe(404);
      const metRes = await metricsGET(
        await authedRequest(`/api/v1/runs/${runId}/metrics?key=k`, org.third),
        { params: Promise.resolve({ runId }) },
      );
      expect(metRes.status).toBe(404);
      const expRes = await exportGET(
        await authedRequest(`/api/v1/runs/${runId}/export`, org.third),
        { params: Promise.resolve({ runId }) },
      );
      expect(expRes.status).toBe(404);

      // Outsider writes: 403/404, never applied.
      const log = await logPOST(
        await authedRequest(`/api/v1/runs/${runId}/log`, org.third, {
          method: "POST",
          body: { points: [{ key: "k", step: 0, value: 1 }] },
        }),
        { params: Promise.resolve({ runId }) },
      );
      expect(log.status).toBe(403);

      const patch = await runPATCH(
        await authedRequest(`/api/v1/runs/${runId}`, org.third, {
          method: "PATCH",
          body: { notes: "hijack" },
        }),
        { params: Promise.resolve({ runId }) },
      );
      expect(patch.status).toBe(403);

      // Member + admin see and touch everything.
      const seen = await runGET(
        await authedRequest(`/api/v1/runs/${runId}`, org.member),
        { params: Promise.resolve({ runId }) },
      );
      expect(seen.status).toBe(200);
      expect(
        ((await seen.json()).run as { group: { slug: string } }).group.slug,
      ).toBe("secret");
      const adminSeen = await runGET(
        await authedRequest(`/api/v1/runs/${runId}`, org.admin),
        { params: Promise.resolve({ runId }) },
      );
      expect(adminSeen.status).toBe(200);

      // Project overview hides the run from the stranger's totals.
      const ov = await overviewGET(
        await authedRequest("/api/v1/x", org.third),
        {
          params: Promise.resolve({ orgSlug: org.orgSlug, projectSlug: "p" }),
        },
      );
      expect(((await ov.json()) as { totalRuns: number }).totalRuns).toBe(0);
      const ovMember = await overviewGET(
        await authedRequest("/api/v1/x", org.member),
        {
          params: Promise.resolve({ orgSlug: org.orgSlug, projectSlug: "p" }),
        },
      );
      expect(((await ovMember.json()) as { totalRuns: number }).totalRuns).toBe(
        1,
      );
    } finally {
      await org.cleanup();
    }
  });

  it("SDK keys enforce membership; moving and ungrouping need rights", async () => {
    const org = await threePersonOrg("grp");
    try {
      await makeGroup(org.admin, { name: "Gated" });
      await addMemberPOST(
        await authedRequest("/api/v1/groups/gated/members", org.admin, {
          method: "POST",
          body: { email: org.member.email },
        }),
        { params: Promise.resolve({ slug: "gated" }) },
      );
      const { plaintext } = generateApiKey();
      await db.apiKey.create({
        data: {
          orgId: org.orgId,
          userId: org.third.userId,
          keyHash: hashApiKey(plaintext),
          label: "stranger-key",
        },
      });

      const denied = await runsPOST(
        apiRequest("/api/v1/runs", {
          method: "POST",
          body: { project: "p", name: "x", group: "gated" },
          apiKey: plaintext,
        }),
      );
      expect(denied.status).toBe(403);

      // Member moves an org-wide run into their group, then back out.
      const mk = await runsPOST(
        await authedRequest("/api/v1/runs", org.third, {
          method: "POST",
          body: { project: "p", name: "movable" },
        }),
      );
      const runId = ((await mk.json()) as { run_id: string }).run_id;
      const strangerMove = await runPATCH(
        await authedRequest(`/api/v1/runs/${runId}`, org.third, {
          method: "PATCH",
          body: { group: "gated" },
        }),
        { params: Promise.resolve({ runId }) },
      );
      expect(strangerMove.status).toBe(403);

      const adminMove = await runPATCH(
        await authedRequest(`/api/v1/runs/${runId}`, org.admin, {
          method: "PATCH",
          body: { group: "gated" },
        }),
        { params: Promise.resolve({ runId }) },
      );
      expect(adminMove.status).toBe(200);

      // Now the stranger cannot even see it; the member ungroups it back.
      const hidden = await runGET(
        await authedRequest(`/api/v1/runs/${runId}`, org.third),
        { params: Promise.resolve({ runId }) },
      );
      expect(hidden.status).toBe(404);
      const ungroup = await runPATCH(
        await authedRequest(`/api/v1/runs/${runId}`, org.member, {
          method: "PATCH",
          body: { group: null },
        }),
        { params: Promise.resolve({ runId }) },
      );
      expect(ungroup.status).toBe(200);
      expect(((await ungroup.json()).run as { group: null }).group).toBeNull();
    } finally {
      await org.cleanup();
    }
  });

  it("deleting a group ungroups runs; only admins manage groups", async () => {
    const org = await threePersonOrg("grp");
    try {
      await makeGroup(org.admin, { name: "Temp", description: "d" });
      await addMemberPOST(
        await authedRequest("/api/v1/groups/temp/members", org.admin, {
          method: "POST",
          body: { email: org.member.email },
        }),
        { params: Promise.resolve({ slug: "temp" }) },
      );
      const mk = await runsPOST(
        await authedRequest("/api/v1/runs", org.member, {
          method: "POST",
          body: { project: "p", name: "grouped", group: "temp" },
        }),
      );
      const runId = ((await mk.json()) as { run_id: string }).run_id;

      const memberDel = await groupDELETE(
        await authedRequest("/api/v1/groups/temp", org.member, {
          method: "DELETE",
        }),
        slug("temp"),
      );
      expect(memberDel.status).toBe(403);

      const del = await groupDELETE(
        await authedRequest("/api/v1/groups/temp", org.admin, {
          method: "DELETE",
        }),
        slug("temp"),
      );
      expect(del.status).toBe(200);

      // Run survives, org-wide, visible to the former stranger.
      const seen = await runGET(
        await authedRequest(`/api/v1/runs/${runId}`, org.third),
        { params: Promise.resolve({ runId }) },
      );
      expect(seen.status).toBe(200);
      expect(((await seen.json()).run as { group: null }).group).toBeNull();

      const gone = await groupGET(
        await authedRequest("/api/v1/groups/temp", org.admin),
        slug("temp"),
      );
      expect(gone.status).toBe(404);

      // Rename/description update works; empty patch → 400.
      await makeGroup(org.admin, { name: "Renamable" });
      const renamed = await groupPATCH(
        await authedRequest("/api/v1/groups/renamable", org.admin, {
          method: "PATCH",
          body: { name: "Renamed", description: "new" },
        }),
        slug("renamable"),
      );
      expect(renamed.status).toBe(200);
      expect(((await renamed.json()).group as { name: string }).name).toBe(
        "Renamed",
      );
      const empty = await groupPATCH(
        await authedRequest("/api/v1/groups/renamable", org.admin, {
          method: "PATCH",
          body: {},
        }),
        slug("renamable"),
      );
      expect(empty.status).toBe(400);
    } finally {
      await org.cleanup();
    }
  });
});
