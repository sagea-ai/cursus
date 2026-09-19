import { describe, expect, it, vi } from "vitest";

import { POST as logPOST } from "@/app/api/v1/runs/[runId]/log/route";
import { POST as runsPOST } from "@/app/api/v1/runs/route";
import { POST as batchPOST } from "@/app/api/v1/projects/[project]/runs/batch/route";
import { db } from "@/lib/db";
import { apiTestsEnabled, authedRequest, createTestOrg } from "../helpers";

const deletedKeys: string[][] = [];
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...actual,
    deleteObjects: async (keys: string[]) => {
      deletedKeys.push(keys);
      return keys.length;
    },
  };
});

async function makeRun(
  session: Parameters<typeof authedRequest>[1],
  project: string,
  name: string,
) {
  const made = await runsPOST(
    await authedRequest("/api/v1/runs", session, {
      method: "POST",
      body: { project, name },
    }),
  );
  expect(made.status).toBe(201);
  return ((await made.json()) as { run_id: string }).run_id;
}

async function logPoints(
  session: Parameters<typeof authedRequest>[1],
  runId: string,
) {
  const res = await logPOST(
    await authedRequest(`/api/v1/runs/${runId}/log`, session, {
      method: "POST",
      body: { points: [{ key: "k", step: 0, value: 1 }] },
    }),
    { params: Promise.resolve({ runId }) },
  );
  expect(res.status).toBe(202);
}

describe.skipIf(!apiTestsEnabled)("bulk run ops", () => {
  it("tags merge; deletes cascade metrics and purge media", async () => {
    const org = await createTestOrg("bulk");
    try {
      const a = await makeRun(org.member, "bp", "a");
      const b = await makeRun(org.member, "bp", "b");
      await logPoints(org.member, a);
      await logPoints(org.member, b);
      // One media row on `a` (bytes irrelevant — storage is mocked).
      await db.mediaItem.create({
        data: {
          runId: a,
          key: "k",
          step: 0,
          mime: "image/png",
          sizeBytes: 10,
          storageKey: "media/x/a",
          status: "COMPLETED",
        },
      });

      const tagged = await batchPOST(
        await authedRequest("/api/v1/projects/bp/runs/batch", org.member, {
          method: "POST",
          body: { ids: [a, b], op: "tag", tags: ["bulk"] },
        }),
        { params: Promise.resolve({ project: "bp" }) },
      );
      expect(tagged.status).toBe(200);
      expect(((await tagged.json()) as { affected: number }).affected).toBe(2);
      for (const id of [a, b]) {
        const row = await db.run.findUniqueOrThrow({ where: { id } });
        expect(row.tags).toContain("bulk");
      }

      const del = await batchPOST(
        await authedRequest("/api/v1/projects/bp/runs/batch", org.member, {
          method: "POST",
          body: { ids: [a, b], op: "delete" },
        }),
        { params: Promise.resolve({ project: "bp" }) },
      );
      expect(del.status).toBe(200);
      expect(((await del.json()) as { affected: number }).affected).toBe(2);
      expect(await db.run.count({ where: { project: { slug: "bp" } } })).toBe(
        0,
      );
      expect(await db.metric.count({ where: { runId: { in: [a, b] } } })).toBe(
        0,
      );
      expect(deletedKeys.flat()).toContain("media/x/a");
    } finally {
      await org.cleanup();
    }
  });

  it("one hidden id fails everything; caps and perms hold", async () => {
    const org = await createTestOrg("bulk");
    try {
      const a = await makeRun(org.member, "bp", "a");
      const missing = await batchPOST(
        await authedRequest("/api/v1/projects/bp/runs/batch", org.member, {
          method: "POST",
          body: { ids: [a, "nope"], op: "delete" },
        }),
        { params: Promise.resolve({ project: "bp" }) },
      );
      expect(missing.status).toBe(404);
      // Zero writes happened.
      expect(await db.run.findUnique({ where: { id: a } })).not.toBeNull();

      const tooMany = await batchPOST(
        await authedRequest("/api/v1/projects/bp/runs/batch", org.member, {
          method: "POST",
          body: {
            ids: Array.from({ length: 101 }, (_, i) => `x${i}`),
            op: "delete",
          },
        }),
        { params: Promise.resolve({ project: "bp" }) },
      );
      expect(tooMany.status).toBe(400);

      const noTags = await batchPOST(
        await authedRequest("/api/v1/projects/bp/runs/batch", org.member, {
          method: "POST",
          body: { ids: [a], op: "tag" },
        }),
        { params: Promise.resolve({ project: "bp" }) },
      );
      expect(noTags.status).toBe(400);

      const other = await createTestOrg("bulkB");
      try {
        const cross = await batchPOST(
          await authedRequest("/api/v1/projects/bp/runs/batch", other.admin, {
            method: "POST",
            body: { ids: [a], op: "delete" },
          }),
          { params: Promise.resolve({ project: "bp" }) },
        );
        expect(cross.status).toBe(404);
      } finally {
        await other.cleanup();
      }

      const { apiRequest } = await import("../helpers");
      const anon = await batchPOST(
        apiRequest("/api/v1/projects/bp/runs/batch", {
          method: "POST",
          body: { ids: [a], op: "delete" },
        }),
        { params: Promise.resolve({ project: "bp" }) },
      );
      expect(anon.status).toBe(401);
    } finally {
      await org.cleanup();
    }
  });
});
