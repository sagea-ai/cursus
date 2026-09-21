import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { GET as fileGET } from "@/app/api/v1/artifact-files/[fileId]/route";
import { POST as initPOST } from "@/app/api/v1/artifacts/init/route";
import { POST as completePOST } from "@/app/api/v1/artifacts/versions/[versionId]/complete/route";
import { GET as detailGET } from "@/app/api/v1/orgs/[orgSlug]/projects/[projectSlug]/artifacts/[name]/route";
import { GET as listGET } from "@/app/api/v1/orgs/[orgSlug]/projects/[projectSlug]/artifacts/route";
import { POST as runsPOST } from "@/app/api/v1/runs/route";
import { db } from "@/lib/db";
import {
  apiRequest,
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
  type TestOrg,
} from "../helpers";

// Storage is mocked: tickets/HEAD never touch MinIO here (E2E covers the
// real path); object existence is simulated per test via `heads`.
const store = {
  enabled: true,
  heads: new Map<string, number>(),
  deleted: [] as string[][],
};
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...actual,
    storageEnabled: () => store.enabled,
    presignPut: async (key: string) => `http://put/${key}`,
    presignGet: async (key: string) => `http://get/${key}`,
    headObject: async (key: string) =>
      store.heads.has(key) ? { size: store.heads.get(key)! } : null,
    deleteObjects: async (keys: string[]) => {
      store.deleted.push(keys);
      return keys.length;
    },
  };
});

function sha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function makeRun(org: TestOrg): Promise<string> {
  const made = await runsPOST(
    await authedRequest("/api/v1/runs", org.member, {
      method: "POST",
      body: { project: "art-proj", name: "art-run" },
    }),
  );
  expect(made.status).toBe(201);
  return ((await made.json()) as { run_id: string }).run_id;
}

async function init(
  session: Parameters<typeof authedRequest>[1],
  body: unknown,
) {
  return initPOST(
    await authedRequest("/api/v1/artifacts/init", session, {
      method: "POST",
      body,
    }),
  );
}

const file = (path: string, content: string) => ({
  path,
  sizeBytes: Buffer.byteLength(content),
  digest: sha(content),
});

describe.skipIf(!apiTestsEnabled)("artifacts routes", () => {
  it("init → complete round-trips; pending stays invisible; legacy bytes serve", async () => {
    const org = await createTestOrg("art");
    try {
      const runId = await makeRun(org);
      const first = await init(org.member, {
        name: "weights",
        type: "model",
        run_id: runId,
        files: [
          file("best.pt", "fake-weights-v1"),
          file("args.yaml", "lr: 0.01"),
        ],
      });
      expect(first.status).toBe(201);
      const v1 = (await first.json()) as {
        version: { version: number; digest: string; sizeBytes: number };
        files: { id: string; path: string; url: string }[];
      };
      expect(v1.version.version).toBe(1);
      expect(v1.files.every((f) => f.url.startsWith("http://put/"))).toBe(true);

      // Pending version: invisible in list/detail, complete-before-PUT 409s.
      const versionId = (
        await db.artifactVersion.findFirstOrThrow({
          where: {
            artifact: { project: { orgId: org.orgId }, name: "weights" },
          },
          orderBy: { version: "desc" },
        })
      ).id;
      const early = await completePOST(
        await authedRequest(
          `/api/v1/artifacts/versions/${versionId}/complete`,
          org.member,
          { method: "POST" },
        ),
        { params: Promise.resolve({ versionId }) },
      );
      expect(early.status).toBe(409);
      const darkList = await listGET(
        await authedRequest("/api/v1/x", org.member),
        {
          params: Promise.resolve({
            orgSlug: org.orgSlug,
            projectSlug: "art-proj",
          }),
        },
      );
      const darkArtifacts = (
        (await darkList.json()) as {
          artifacts: { latest: unknown; versionCount: number }[];
        }
      ).artifacts;
      expect(darkArtifacts).toHaveLength(1);
      expect(darkArtifacts[0]!.latest).toBeNull();
      expect(darkArtifacts[0]!.versionCount).toBe(0);

      // "Upload" the bytes (simulated) and complete.
      for (const f of v1.files) {
        store.heads.set(
          `artifacts/${org.orgId}/${
            (
              await db.artifact.findFirstOrThrow({
                where: { project: { orgId: org.orgId }, name: "weights" },
              })
            ).id
          }/v1/${sha(f.path === "best.pt" ? "fake-weights-v1" : "lr: 0.01")}`,
          10,
        );
      }
      const done = await completePOST(
        await authedRequest(
          `/api/v1/artifacts/versions/${versionId}/complete`,
          org.member,
          { method: "POST" },
        ),
        { params: Promise.resolve({ versionId }) },
      );
      expect(done.status).toBe(200);

      // Second version increments.
      const second = await init(org.member, {
        name: "weights",
        run_id: runId,
        files: [file("best.pt", "fake-weights-v2")],
      });
      const v2 = (await second.json()) as {
        version: { version: number };
        files: { id: string }[];
      };
      const v2id = (
        await db.artifactVersion.findFirstOrThrow({
          where: {
            artifact: { project: { orgId: org.orgId }, name: "weights" },
          },
          orderBy: { version: "desc" },
        })
      ).id;
      for (const row of await db.artifactFile.findMany({
        where: { versionId: v2id },
      })) {
        store.heads.set(row.storageKey!, 10);
      }
      await completePOST(
        await authedRequest(
          `/api/v1/artifacts/versions/${v2id}/complete`,
          org.member,
          { method: "POST" },
        ),
        { params: Promise.resolve({ versionId: v2id }) },
      );
      expect(v2.version.version).toBe(2);

      // S3-backed download redirects to a presigned GET.
      const dl = await fileGET(
        await authedRequest(
          `/api/v1/artifact-files/${v2.files[0]!.id}`,
          org.member,
        ),
        { params: Promise.resolve({ fileId: v2.files[0]!.id }) },
      );
      expect(dl.status).toBe(307);
      expect(dl.headers.get("location")!).toMatch(/^http:\/\/get\//);

      // Legacy DB-bytes row downloads inline.
      const legacy = await db.artifactFile.create({
        data: {
          versionId: v2id,
          path: "legacy.bin",
          sizeBytes: 4,
          digest: sha("abcd"),
          data: Buffer.from("abcd"),
        },
      });
      const legacyDl = await fileGET(
        await authedRequest(`/api/v1/artifact-files/${legacy.id}`, org.member),
        { params: Promise.resolve({ fileId: legacy.id }) },
      );
      expect(legacyDl.status).toBe(200);
      expect(await legacyDl.text()).toBe("abcd");

      // List shows latest completed; detail selects versions via ?v=.
      const list = await listGET(await authedRequest("/api/v1/x", org.member), {
        params: Promise.resolve({
          orgSlug: org.orgSlug,
          projectSlug: "art-proj",
        }),
      });
      const artifacts = (
        (await list.json()) as {
          artifacts: { name: string; latest: { version: number } | null }[];
        }
      ).artifacts;
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]!.latest!.version).toBe(2);

      const detailParams = {
        params: Promise.resolve({
          orgSlug: org.orgSlug,
          projectSlug: "art-proj",
          name: "weights",
        }),
      };
      const v1detail = await detailGET(
        await authedRequest("/api/v1/x?v=1", org.member),
        detailParams,
      );
      const v1body = (await v1detail.json()) as {
        artifact: {
          selected: { version: number; files: { path: string }[] };
          versions: { version: number }[];
        };
      };
      expect(v1body.artifact.selected.version).toBe(1);
      expect(v1body.artifact.selected.files.map((f) => f.path).sort()).toEqual([
        "args.yaml",
        "best.pt",
      ]);
      expect(v1body.artifact.versions.map((v) => v.version)).toEqual([2, 1]);
    } finally {
      store.heads.clear();
      await org.cleanup();
    }
  });

  it("rejects bad specs, oversize actuals, strangers, and no-storage", async () => {
    const org = await createTestOrg("art");
    const other = await createTestOrg("artB");
    try {
      const runId = await makeRun(org);
      const badName = await init(org.member, {
        name: "not a valid name!",
        run_id: runId,
        files: [file("f.bin", "x")],
      });
      expect(badName.status).toBe(400);
      const empty = await init(org.member, {
        name: "w",
        run_id: runId,
        files: [],
      });
      expect(empty.status).toBe(400);
      const dup = await init(org.member, {
        name: "w",
        run_id: runId,
        files: [file("same.bin", "a"), file("same.bin", "b")],
      });
      expect(dup.status).toBe(400);
      const evil = await init(org.member, {
        name: "w",
        run_id: runId,
        files: [{ path: "../escape.bin", sizeBytes: 1, digest: sha("x") }],
      });
      expect(evil.status).toBe(400);
      const badDigest = await init(org.member, {
        name: "w",
        run_id: runId,
        files: [{ path: "f.bin", sizeBytes: 1, digest: "zzz" }],
      });
      expect(badDigest.status).toBe(400);
      const noProject = await init(org.member, {
        name: "w",
        files: [file("f.bin", "x")],
      });
      expect(noProject.status).toBe(400);

      // Oversize actual bytes 413 even with an innocent claim.
      const bigInit = await init(org.member, {
        name: "big",
        run_id: runId,
        files: [file("big.bin", "x")],
      });
      expect(bigInit.status).toBe(201);
      const bigId = (
        await db.artifactVersion.findFirstOrThrow({
          where: { artifact: { project: { orgId: org.orgId }, name: "big" } },
        })
      ).id;
      for (const row of await db.artifactFile.findMany({
        where: { versionId: bigId },
      })) {
        store.heads.set(row.storageKey!, 2 * 1024 * 1024 * 1024);
      }
      const over = await completePOST(
        await authedRequest(
          `/api/v1/artifacts/versions/${bigId}/complete`,
          org.member,
          { method: "POST" },
        ),
        { params: Promise.resolve({ versionId: bigId }) },
      );
      expect(over.status).toBe(413);
      expect(
        await db.artifactVersion.findUnique({ where: { id: bigId } }),
      ).toBeNull();

      // Cross-org 404, anon 401, viewer 403, storage-off 503.
      const crossList = await listGET(
        await authedRequest("/api/v1/x", other.admin),
        {
          params: Promise.resolve({
            orgSlug: org.orgSlug,
            projectSlug: "art-proj",
          }),
        },
      );
      expect(crossList.status).toBe(404);
      const anon = await listGET(apiRequest("/api/v1/x"), {
        params: Promise.resolve({
          orgSlug: org.orgSlug,
          projectSlug: "art-proj",
        }),
      });
      expect(anon.status).toBe(401);

      store.enabled = false;
      try {
        const off = await init(org.member, {
          name: "w",
          run_id: runId,
          files: [file("f.bin", "x")],
        });
        expect(off.status).toBe(503);
      } finally {
        store.enabled = true;
      }
    } finally {
      store.heads.clear();
      await other.cleanup();
      await org.cleanup();
    }
  });

  it("project delete purges version objects", async () => {
    const org = await createTestOrg("art");
    try {
      const runId = await makeRun(org);
      const res = await init(org.member, {
        name: "gone",
        run_id: runId,
        files: [file("a.bin", "data")],
      });
      expect(res.status).toBe(201);
      const versionId = (
        await db.artifactVersion.findFirstOrThrow({
          where: { artifact: { project: { orgId: org.orgId }, name: "gone" } },
        })
      ).id;
      for (const row of await db.artifactFile.findMany({
        where: { versionId },
      })) {
        store.heads.set(row.storageKey!, 4);
      }
      await completePOST(
        await authedRequest(
          `/api/v1/artifacts/versions/${versionId}/complete`,
          org.member,
          { method: "POST" },
        ),
        { params: Promise.resolve({ versionId }) },
      );
      const { DELETE: deleteProject } =
        await import("@/app/api/v1/orgs/[orgSlug]/projects/[projectSlug]/route");
      store.deleted.length = 0;
      const del = await deleteProject(
        await authedRequest(
          `/api/v1/orgs/${org.orgSlug}/projects/art-proj`,
          org.admin,
          { method: "DELETE" },
        ),
        {
          params: Promise.resolve({
            orgSlug: org.orgSlug,
            projectSlug: "art-proj",
          }),
        },
      );
      expect(del.status).toBe(200);
      expect(store.deleted.flat().length).toBeGreaterThan(0);
    } finally {
      store.heads.clear();
      await org.cleanup();
    }
  });
});
