import { describe, expect, it } from "vitest";

import { POST as finishPOST } from "@/app/api/v1/runs/[runId]/finish/route";
import { POST as logPOST } from "@/app/api/v1/runs/[runId]/log/route";
import { PATCH as renamePATCH } from "@/app/api/v1/runs/[runId]/route";
import { GET as exportGET } from "@/app/api/v1/runs/[runId]/export/route";
import { POST as runsPOST } from "@/app/api/v1/runs/route";
import { POST as invitePOST } from "@/app/api/v1/team/invite/route";
import { POST as acceptPOST } from "@/app/api/v1/auth/invites/accept/route";
import { POST as createKeyPOST } from "@/app/api/v1/keys/route";
import { GET as projectsGET } from "@/app/api/v1/orgs/[orgSlug]/projects/route";
import { db } from "@/lib/db";
import type { Session } from "@/lib/auth";
import {
  apiRequest,
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
  testEmail,
} from "../helpers";

async function makeViewer(org: {
  admin: Session;
  orgId: string;
}): Promise<Session> {
  const email = testEmail("viewer");
  const invited = await invitePOST(
    await authedRequest("/api/v1/team/invite", org.admin, {
      method: "POST",
      body: { email, role: "VIEWER" },
    }),
  );
  expect(invited.status).toBe(201);
  const token = ((await invited.json()) as { inviteUrl: string }).inviteUrl
    .split("/")
    .pop()!;
  const accepted = await acceptPOST(
    apiRequest("/api/v1/auth/invites/accept", {
      method: "POST",
      body: { token, password: "Viewer-password-1", name: "Vera Viewer" },
    }),
  );
  expect(accepted.status).toBe(200);
  const row = await db.user.findUniqueOrThrow({ where: { email } });
  expect(row.role).toBe("VIEWER");
  return { userId: row.id, orgId: org.orgId, email, role: "VIEWER" };
}

describe.skipIf(!apiTestsEnabled)("viewer role", () => {
  it("reads everything visible, writes nothing", async () => {
    const org = await createTestOrg("viewer");
    try {
      const made = await runsPOST(
        await authedRequest("/api/v1/runs", org.admin, {
          method: "POST",
          body: { project: "vp", name: "v-run" },
        }),
      );
      const runId = ((await made.json()) as { run_id: string }).run_id;
      const viewer = await makeViewer(org);

      // Reads: project list, run get, export.
      const projects = await projectsGET(
        await authedRequest(`/api/v1/orgs/${org.orgSlug}/projects`, viewer),
        { params: Promise.resolve({ orgSlug: org.orgSlug }) },
      );
      expect(projects.status).toBe(200);
      const { GET: runGET } = await import("@/app/api/v1/runs/[runId]/route");
      const got = await runGET(
        await authedRequest(`/api/v1/runs/${runId}`, viewer),
        { params: Promise.resolve({ runId }) },
      );
      expect(got.status).toBe(200);
      const exp = await exportGET(
        await authedRequest(`/api/v1/runs/${runId}/export`, viewer),
        { params: Promise.resolve({ runId }) },
      );
      expect(exp.status).toBe(200);

      // Writes: every one is a 403.
      const create = await runsPOST(
        await authedRequest("/api/v1/runs", viewer, {
          method: "POST",
          body: { project: "vp", name: "nope" },
        }),
      );
      expect(create.status).toBe(403);
      const log = await logPOST(
        await authedRequest(`/api/v1/runs/${runId}/log`, viewer, {
          method: "POST",
          body: { points: [{ key: "k", step: 0, value: 1 }] },
        }),
        { params: Promise.resolve({ runId }) },
      );
      expect(log.status).toBe(403);
      const fin = await finishPOST(
        await authedRequest(`/api/v1/runs/${runId}/finish`, viewer, {
          method: "POST",
          body: { status: "finished" },
        }),
        { params: Promise.resolve({ runId }) },
      );
      expect(fin.status).toBe(403);
      const ren = await renamePATCH(
        await authedRequest(`/api/v1/runs/${runId}`, viewer, {
          method: "PATCH",
          body: { name: "hacked" },
        }),
        { params: Promise.resolve({ runId }) },
      );
      expect(ren.status).toBe(403);
      const { POST: createProjectPOST } =
        await import("@/app/api/v1/orgs/[orgSlug]/projects/route");
      const proj = await createProjectPOST(
        await authedRequest(`/api/v1/orgs/${org.orgSlug}/projects`, viewer, {
          method: "POST",
          body: { name: "viewer-proj" },
        }),
        { params: Promise.resolve({ orgSlug: org.orgSlug }) },
      );
      expect(proj.status).toBe(403);
      const inv = await invitePOST(
        await authedRequest("/api/v1/team/invite", viewer, {
          method: "POST",
          body: { email: testEmail("x") },
        }),
      );
      expect(inv.status).toBe(403);
    } finally {
      await org.cleanup();
    }
  }, 60_000);

  it("viewer API keys read but never write via ingestion", async () => {
    const org = await createTestOrg("viewer");
    try {
      const made = await runsPOST(
        await authedRequest("/api/v1/runs", org.admin, {
          method: "POST",
          body: { project: "vp", name: "v-run" },
        }),
      );
      const runId = ((await made.json()) as { run_id: string }).run_id;
      const viewer = await makeViewer(org);

      // Viewers manage their own keys (read-scoped).
      const created = await createKeyPOST(
        await authedRequest("/api/v1/keys", viewer, {
          method: "POST",
          body: { label: "viewer-key" },
        }),
      );
      expect(created.status).toBe(201);
      const { plaintext } = (await created.json()) as { plaintext: string };

      // Reads with the key work…
      const { GET: runGET } = await import("@/app/api/v1/runs/[runId]/route");
      const got = await runGET(
        apiRequest(`/api/v1/runs/${runId}`, { apiKey: plaintext }),
        { params: Promise.resolve({ runId }) },
      );
      expect(got.status).toBe(200);
      // …writes do not.
      const log = await logPOST(
        apiRequest(`/api/v1/runs/${runId}/log`, {
          method: "POST",
          apiKey: plaintext,
          body: { points: [{ key: "k", step: 0, value: 1 }] },
        }),
        { params: Promise.resolve({ runId }) },
      );
      expect(log.status).toBe(403);
    } finally {
      await org.cleanup();
    }
  }, 60_000);

  it("admins move members to viewer and back; last admin is safe", async () => {
    const org = await createTestOrg("viewer");
    try {
      const { PATCH: rolePATCH } =
        await import("@/app/api/v1/team/members/[userId]/role/route");
      const down = await rolePATCH(
        await authedRequest(
          `/api/v1/team/members/${org.member.userId}/role`,
          org.admin,
          { method: "PATCH", body: { role: "VIEWER" } },
        ),
        { params: Promise.resolve({ userId: org.member.userId }) },
      );
      expect(down.status).toBe(200);
      expect(
        ((await down.json()) as { user: { role: string } }).user.role,
      ).toBe("VIEWER");
      // Demoting the last admin to viewer is a 409, like member.
      const last = await rolePATCH(
        await authedRequest(
          `/api/v1/team/members/${org.admin.userId}/role`,
          org.admin,
          { method: "PATCH", body: { role: "VIEWER" } },
        ),
        { params: Promise.resolve({ userId: org.admin.userId }) },
      );
      expect(last.status).toBe(409);
      const up = await rolePATCH(
        await authedRequest(
          `/api/v1/team/members/${org.member.userId}/role`,
          org.admin,
          { method: "PATCH", body: { role: "MEMBER" } },
        ),
        { params: Promise.resolve({ userId: org.member.userId }) },
      );
      expect(up.status).toBe(200);
    } finally {
      await org.cleanup();
    }
  });
});
