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
import { PATCH as updateProjectPATCH } from "@/app/api/v1/orgs/[orgSlug]/projects/[projectSlug]/route";
import { POST as createProjectPOST } from "@/app/api/v1/orgs/[orgSlug]/projects/route";
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

async function makeProject(
  session: Session,
  orgSlug: string,
  body: Record<string, string>,
  status = 201,
) {
  const res = await createProjectPOST(
    await authedRequest(`/api/v1/orgs/${orgSlug}/projects`, session, {
      method: "POST",
      body,
    }),
    { params: Promise.resolve({ orgSlug }) },
  );
  expect(res.status).toBe(status);
  return res;
}

async function addToGroup(admin: Session, groupSlug: string, email: string) {
  const res = await addMemberPOST(
    await authedRequest(`/api/v1/groups/${groupSlug}/members`, admin, {
      method: "POST",
      body: { email },
    }),
    { params: Promise.resolve({ slug: groupSlug }) },
  );
  expect(res.status).toBe(201);
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
      await addToGroup(org.admin, "g1", org.member.email);

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

  it("members create projects in their groups; strangers cannot plant any", async () => {
    const org = await threePersonOrg("grp");
    try {
      await makeGroup(org.admin, { name: "Secret" });
      await addToGroup(org.admin, "secret", org.member.email);

      const ok = await makeProject(org.member, org.orgSlug, {
        name: "Secret Project",
        group: "secret",
      });
      expect(((await ok.json()).project as { slug: string }).slug).toBe(
        "secret-project",
      );

      const stranger = await makeProject(
        org.third,
        org.orgSlug,
        { name: "Sneaky", group: "secret" },
        403,
      );
      expect((await stranger.json()).error).toBe("not a member of this group");

      const missing = await makeProject(
        org.member,
        org.orgSlug,
        { name: "Lost", group: "nope" },
        404,
      );
      expect((await missing.json()).error).toBe("group not found");
    } finally {
      await org.cleanup();
    }
  });

  it("grouped projects hide runs from outsiders on every surface", async () => {
    const org = await threePersonOrg("grp");
    try {
      await makeGroup(org.admin, { name: "Secret" });
      await addToGroup(org.admin, "secret", org.member.email);
      await makeProject(org.member, org.orgSlug, {
        name: "Secret Project",
        group: "secret",
      });

      const mk = await runsPOST(
        await authedRequest("/api/v1/runs", org.member, {
          method: "POST",
          body: { project: "secret-project", name: "hidden" },
        }),
      );
      expect(mk.status).toBe(201);
      const runId = ((await mk.json()) as { run_id: string }).run_id;

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
      const ovRes = await overviewGET(
        await authedRequest("/api/v1/x", org.third),
        {
          params: Promise.resolve({
            orgSlug: org.orgSlug,
            projectSlug: "secret-project",
          }),
        },
      );
      expect(ovRes.status).toBe(404);

      // Outsider writes: 403, never applied.
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

      // Project overview counts the run for members only.
      const ovMember = await overviewGET(
        await authedRequest("/api/v1/x", org.member),
        {
          params: Promise.resolve({
            orgSlug: org.orgSlug,
            projectSlug: "secret-project",
          }),
        },
      );
      expect(((await ovMember.json()) as { totalRuns: number }).totalRuns).toBe(
        1,
      );
    } finally {
      await org.cleanup();
    }
  });

  it("SDK group param resolves or creates the project inside the group", async () => {
    const org = await threePersonOrg("grp");
    try {
      await makeGroup(org.admin, { name: "Gated" });
      await addToGroup(org.admin, "gated", org.member.email);
      const { plaintext } = generateApiKey();
      await db.apiKey.create({
        data: {
          orgId: org.orgId,
          userId: org.third.userId,
          keyHash: hashApiKey(plaintext),
          label: "stranger-key",
        },
      });

      // Stranger's key cannot log into the group.
      const denied = await runsPOST(
        apiRequest("/api/v1/runs", {
          method: "POST",
          body: { project: "gated-proj", name: "x", group: "gated" },
          apiKey: plaintext,
        }),
      );
      expect(denied.status).toBe(403);

      // Member's first log creates the project inside the group.
      const { plaintext: memberKey, keyHash } = generateApiKey();
      await db.apiKey.create({
        data: {
          orgId: org.orgId,
          userId: org.member.userId,
          keyHash,
          label: "member-key",
        },
      });
      const created = await runsPOST(
        apiRequest("/api/v1/runs", {
          method: "POST",
          body: { project: "gated-proj", name: "first", group: "gated" },
          apiKey: memberKey,
        }),
      );
      expect(created.status).toBe(201);

      // Same project + different group = conflict, not a silent move
      // (as admin, so membership checks pass and only consistency bites).
      await makeGroup(org.admin, { name: "Other" });
      const conflict = await runsPOST(
        await authedRequest("/api/v1/runs", org.admin, {
          method: "POST",
          body: { project: "gated-proj", name: "second", group: "other" },
        }),
      );
      expect(conflict.status).toBe(409);

      // Existing org-wide project + group param → 409.
      await makeProject(org.admin, org.orgSlug, { name: "Shared" });
      const clash = await runsPOST(
        await authedRequest("/api/v1/runs", org.member, {
          method: "POST",
          body: { project: "shared", name: "x", group: "gated" },
        }),
      );
      expect(clash.status).toBe(409);
    } finally {
      await org.cleanup();
    }
  });

  it("only admins move projects; deleting a group ungroups them", async () => {
    const org = await threePersonOrg("grp");
    try {
      await makeGroup(org.admin, { name: "Temp" });
      await addToGroup(org.admin, "temp", org.member.email);
      await makeProject(org.member, org.orgSlug, {
        name: "Temp Project",
        group: "temp",
      });
      const mk = await runsPOST(
        await authedRequest("/api/v1/runs", org.member, {
          method: "POST",
          body: { project: "temp-project", name: "grouped" },
        }),
      );
      const runId = ((await mk.json()) as { run_id: string }).run_id;

      const delParams = (slug: string) => ({
        params: Promise.resolve({ orgSlug: org.orgSlug, projectSlug: slug }),
      });
      const memberMove = await updateProjectPATCH(
        await authedRequest("/api/v1/x", org.member, {
          method: "PATCH",
          body: { group: null },
        }),
        delParams("temp-project"),
      );
      expect(memberMove.status).toBe(403);

      const adminMove = await updateProjectPATCH(
        await authedRequest("/api/v1/x", org.admin, {
          method: "PATCH",
          body: { group: null },
        }),
        delParams("temp-project"),
      );
      expect(adminMove.status).toBe(200);
      expect(
        ((await adminMove.json()).project as { group: null }).group,
      ).toBeNull();

      // Run is org-wide now: the former stranger sees it.
      const seen = await runGET(
        await authedRequest(`/api/v1/runs/${runId}`, org.third),
        { params: Promise.resolve({ runId }) },
      );
      expect(seen.status).toBe(200);

      // Move it back, then delete the group: project ungroups, run survives.
      const back = await updateProjectPATCH(
        await authedRequest("/api/v1/x", org.admin, {
          method: "PATCH",
          body: { group: "temp" },
        }),
        delParams("temp-project"),
      );
      expect(back.status).toBe(200);
      const hidden = await runGET(
        await authedRequest(`/api/v1/runs/${runId}`, org.third),
        { params: Promise.resolve({ runId }) },
      );
      expect(hidden.status).toBe(404);

      const memberDel = await groupDELETE(
        await authedRequest("/api/v1/groups/temp", org.member, {
          method: "DELETE",
        }),
        slug("temp"),
      );
      expect(memberDel.status).toBe(403);

      const renamed = await groupPATCH(
        await authedRequest("/api/v1/groups/temp", org.admin, {
          method: "PATCH",
          body: { name: "Temporary", description: "renamed" },
        }),
        slug("temp"),
      );
      expect(renamed.status).toBe(200);
      expect(((await renamed.json()).group as { name: string }).name).toBe(
        "Temporary",
      );
      const del = await groupDELETE(
        await authedRequest("/api/v1/groups/temp", org.admin, {
          method: "DELETE",
        }),
        slug("temp"),
      );
      expect(del.status).toBe(200);
      const visible = await runGET(
        await authedRequest(`/api/v1/runs/${runId}`, org.third),
        { params: Promise.resolve({ runId }) },
      );
      expect(visible.status).toBe(200);

      const gone = await groupGET(
        await authedRequest("/api/v1/groups/temp", org.admin),
        slug("temp"),
      );
      expect(gone.status).toBe(404);
    } finally {
      await org.cleanup();
    }
  });

  it("rename still works; empty patch → 400", async () => {
    const org = await threePersonOrg("grp");
    try {
      await makeProject(org.member, org.orgSlug, { name: "Renamable" });
      const renamed = await updateProjectPATCH(
        await authedRequest("/api/v1/x", org.member, {
          method: "PATCH",
          body: { name: "Renamed" },
        }),
        {
          params: Promise.resolve({
            orgSlug: org.orgSlug,
            projectSlug: "renamable",
          }),
        },
      );
      expect(renamed.status).toBe(200);
      expect(((await renamed.json()).project as { name: string }).name).toBe(
        "Renamed",
      );
      const empty = await updateProjectPATCH(
        await authedRequest("/api/v1/x", org.member, {
          method: "PATCH",
          body: {},
        }),
        {
          params: Promise.resolve({
            orgSlug: org.orgSlug,
            projectSlug: "renamable",
          }),
        },
      );
      expect(empty.status).toBe(400);
    } finally {
      await org.cleanup();
    }
  });
});
