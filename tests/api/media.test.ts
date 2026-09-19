import { describe, expect, it, vi } from "vitest";

import { POST as uploadPOST } from "@/app/api/v1/runs/[runId]/media/upload-url/route";
import { POST as completePOST } from "@/app/api/v1/runs/[runId]/media/[mediaId]/complete/route";
import { GET as listGET } from "@/app/api/v1/runs/[runId]/media/route";
import { GET as keysGET } from "@/app/api/v1/runs/[runId]/media/keys/route";
import { POST as runsPOST } from "@/app/api/v1/runs/route";
import { POST as groupsPOST } from "@/app/api/v1/groups/route";
import { POST as addMemberPOST } from "@/app/api/v1/groups/[slug]/members/route";
import { POST as createProjectPOST } from "@/app/api/v1/orgs/[orgSlug]/projects/route";
import { db } from "@/lib/db";
import { apiTestsEnabled, authedRequest, createTestOrg } from "../helpers";

// Storage is mocked: presigning/HEAD never touch MinIO here (the live
// round-trip is proven separately; E2E covers the real path).
const store = { enabled: true, head: true };
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...actual,
    storageEnabled: () => store.enabled,
    presignPut: async () => "http://put/ticket",
    presignGet: async (key: string) => `http://get/${key}`,
    headObject: async () => (store.head ? { size: 10 } : null),
    deleteObjects: async () => 0,
  };
});

async function makeRun(
  session: Parameters<typeof authedRequest>[1],
  project = "mp",
) {
  const made = await runsPOST(
    await authedRequest("/api/v1/runs", session, {
      method: "POST",
      body: { project, name: "media-run" },
    }),
  );
  expect(made.status).toBe(201);
  return ((await made.json()) as { run_id: string }).run_id;
}

const ticket = {
  key: "val/samples",
  step: 2,
  mime: "image/png",
  sizeBytes: 10,
};

describe.skipIf(!apiTestsEnabled)("media routes", () => {
  it("ticket → complete → list → keys round-trip", async () => {
    const org = await createTestOrg("media");
    try {
      const runId = await makeRun(org.member);
      const up = await uploadPOST(
        await authedRequest(
          `/api/v1/runs/${runId}/media/upload-url`,
          org.member,
          {
            method: "POST",
            body: ticket,
          },
        ),
        { params: Promise.resolve({ runId }) },
      );
      expect(up.status).toBe(201);
      const body = (await up.json()) as {
        mediaId: string;
        url: string;
        method: string;
      };
      expect(body.url).toBe("http://put/ticket");
      expect(body.method).toBe("PUT");

      const done = await completePOST(
        await authedRequest(
          `/api/v1/runs/${runId}/media/${body.mediaId}/complete`,
          org.member,
          { method: "POST" },
        ),
        { params: Promise.resolve({ runId, mediaId: body.mediaId }) },
      );
      expect(done.status).toBe(200);

      const list = await listGET(
        await authedRequest(
          `/api/v1/runs/${runId}/media?key=${encodeURIComponent(ticket.key)}`,
          org.member,
        ),
        { params: Promise.resolve({ runId }) },
      );
      expect(list.status).toBe(200);
      const steps = ((await list.json()) as { steps: unknown[] }).steps;
      expect(steps).toHaveLength(1);

      const keys = await keysGET(
        await authedRequest(`/api/v1/runs/${runId}/media/keys`, org.member),
        { params: Promise.resolve({ runId }) },
      );
      expect(((await keys.json()) as { keys: string[] }).keys).toEqual([
        "val/samples",
      ]);
    } finally {
      await org.cleanup();
    }
  });

  it("re-logging a step upserts; complete-before-PUT is 409", async () => {
    const org = await createTestOrg("media");
    try {
      const runId = await makeRun(org.member);
      const first = (await (
        await uploadPOST(
          await authedRequest(
            `/api/v1/runs/${runId}/media/upload-url`,
            org.member,
            {
              method: "POST",
              body: ticket,
            },
          ),
          { params: Promise.resolve({ runId }) },
        )
      ).json()) as { mediaId: string };
      const second = (await (
        await uploadPOST(
          await authedRequest(
            `/api/v1/runs/${runId}/media/upload-url`,
            org.member,
            {
              method: "POST",
              body: ticket,
            },
          ),
          { params: Promise.resolve({ runId }) },
        )
      ).json()) as { mediaId: string };
      expect(second.mediaId).toBe(first.mediaId);
      expect(await db.mediaItem.count({ where: { runId } })).toBe(1);

      store.head = false;
      try {
        const early = await completePOST(
          await authedRequest(
            `/api/v1/runs/${runId}/media/${first.mediaId}/complete`,
            org.member,
            { method: "POST" },
          ),
          { params: Promise.resolve({ runId, mediaId: first.mediaId }) },
        );
        expect(early.status).toBe(409);
      } finally {
        store.head = true;
      }
    } finally {
      await org.cleanup();
    }
  });

  it("rejects bad mime, oversize, caps, strangers, anon, and no-storage", async () => {
    const org = await createTestOrg("media");
    try {
      const runId = await makeRun(org.member);
      const post = async (body: unknown, session = org.member) =>
        uploadPOST(
          await authedRequest(
            `/api/v1/runs/${runId}/media/upload-url`,
            session,
            {
              method: "POST",
              body,
            },
          ),
          { params: Promise.resolve({ runId }) },
        );
      expect((await post({ ...ticket, mime: "image/gif" })).status).toBe(400);
      expect(
        (await post({ ...ticket, sizeBytes: 6 * 1024 * 1024 })).status,
      ).toBe(413);

      // Fill to the 500-image cap, then one more fails.
      const rows = Array.from({ length: 500 }, (_, i) => ({
        runId,
        key: `k${i}`,
        step: 0,
        mime: "image/png",
        sizeBytes: 10,
        storageKey: `s${i}`,
        status: "COMPLETED" as const,
      }));
      await db.mediaItem.createMany({ data: rows });
      expect((await post({ ...ticket, key: "overflow" })).status).toBe(413);
      await db.mediaItem.deleteMany({ where: { runId } });

      // Cross-org run is a 404; anon is a 401.
      const other = await createTestOrg("mediaB");
      try {
        const cross = await uploadPOST(
          await authedRequest(
            `/api/v1/runs/${runId}/media/upload-url`,
            other.admin,
            { method: "POST", body: ticket },
          ),
          { params: Promise.resolve({ runId }) },
        );
        expect(cross.status).toBe(404);
      } finally {
        await other.cleanup();
      }
      const { apiRequest } = await import("../helpers");
      expect(
        (
          await uploadPOST(
            apiRequest(`/api/v1/runs/${runId}/media/upload-url`, {
              method: "POST",
              body: ticket,
            }),
            { params: Promise.resolve({ runId }) },
          )
        ).status,
      ).toBe(401);

      // Storage unconfigured → 503, not an obscure S3 failure.
      store.enabled = false;
      try {
        expect((await post(ticket)).status).toBe(503);
      } finally {
        store.enabled = true;
      }
    } finally {
      await org.cleanup();
    }
  });

  it("group outsiders cannot ticket; keys/list hide left groups", async () => {
    const org = await createTestOrg("media");
    try {
      await groupsPOST(
        await authedRequest("/api/v1/groups", org.admin, {
          method: "POST",
          body: { name: "G" },
        }),
      );
      await createProjectPOST(
        await authedRequest(`/api/v1/orgs/${org.orgSlug}/projects`, org.admin, {
          method: "POST",
          body: { name: "Grouped", group: "g" },
        }),
        { params: Promise.resolve({ orgSlug: org.orgSlug }) },
      );
      const made = await runsPOST(
        await authedRequest("/api/v1/runs", org.admin, {
          method: "POST",
          body: { project: "grouped", name: "gr", group: "g" },
        }),
      );
      const runId = ((await made.json()) as { run_id: string }).run_id;
      const forbidden = await uploadPOST(
        await authedRequest(
          `/api/v1/runs/${runId}/media/upload-url`,
          org.member,
          {
            method: "POST",
            body: ticket,
          },
        ),
        { params: Promise.resolve({ runId }) },
      );
      expect(forbidden.status).toBe(403);

      // Member joins, uploads, then leaves: keys/list go 404-dark.
      await addMemberPOST(
        await authedRequest("/api/v1/groups/g/members", org.admin, {
          method: "POST",
          body: { email: org.member.email },
        }),
        { params: Promise.resolve({ slug: "g" }) },
      );
      const ok = await uploadPOST(
        await authedRequest(
          `/api/v1/runs/${runId}/media/upload-url`,
          org.member,
          {
            method: "POST",
            body: ticket,
          },
        ),
        { params: Promise.resolve({ runId }) },
      );
      expect(ok.status).toBe(201);
      const { DELETE: removeMember } =
        await import("@/app/api/v1/groups/[slug]/members/[userId]/route");
      const memberRow = await db.user.findUniqueOrThrow({
        where: { email: org.member.email },
      });
      await removeMember(
        await authedRequest(
          `/api/v1/groups/g/members/${memberRow.id}`,
          org.admin,
          { method: "DELETE" },
        ),
        { params: Promise.resolve({ slug: "g", userId: memberRow.id }) },
      );
      const dark = await keysGET(
        await authedRequest(`/api/v1/runs/${runId}/media/keys`, org.member),
        { params: Promise.resolve({ runId }) },
      );
      expect(dark.status).toBe(404);
    } finally {
      await org.cleanup();
    }
  });
});
