import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { GET as fileGET } from "@/app/api/v1/artifact-files/[fileId]/route";
import { POST as uploadPOST } from "@/app/api/v1/artifacts/route";
import { SESSION_COOKIE, signSession } from "@/lib/session";
import { GET as detailGET } from "@/app/api/v1/orgs/[orgSlug]/projects/[projectSlug]/artifacts/[name]/route";
import { GET as listGET } from "@/app/api/v1/orgs/[orgSlug]/projects/[projectSlug]/artifacts/route";
import { POST as runsPOST } from "@/app/api/v1/runs/route";
import {
  apiRequest,
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
  type TestOrg,
} from "../helpers";

async function upload(
  session: TestOrg["member"],
  fields: Record<string, string>,
  files: { name: string; content: string }[],
) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const f of files) {
    form.append("files", new File([f.content], f.name));
  }
  const req = new NextRequest("http://test.local/api/v1/artifacts", {
    method: "POST",
    body: form,
  });
  req.cookies.set(SESSION_COOKIE, await signSession(session));
  return uploadPOST(req);
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

describe.skipIf(!apiTestsEnabled)("artifacts routes", () => {
  it("uploads versions, increments, and downloads bytes intact", async () => {
    const org = await createTestOrg("art");
    try {
      const runId = await makeRun(org);
      const first = await upload(
        org.member,
        { name: "weights", type: "model", run_id: runId },
        [
          { name: "best.pt", content: "fake-weights-v1" },
          { name: "args.yaml", content: "lr: 0.01" },
        ],
      );
      expect(first.status).toBe(201);
      const v1 = (await first.json()) as {
        artifact: { name: string };
        version: { version: number; digest: string; sizeBytes: number };
        files: { id: string; path: string }[];
      };
      expect(v1.version.version).toBe(1);
      expect(v1.files.map((f) => f.path).sort()).toEqual([
        "args.yaml",
        "best.pt",
      ]);

      const second = await upload(
        org.member,
        { name: "weights", run_id: runId },
        [{ name: "best.pt", content: "fake-weights-v2" }],
      );
      const v2 = (await second.json()) as { version: { version: number } };
      expect(v2.version.version).toBe(2);

      // Download round-trips exact bytes.
      const fileId = v1.files.find((f) => f.path === "best.pt")!.id;
      const dl = await fileGET(
        await authedRequest(`/api/v1/artifact-files/${fileId}`, org.member),
        { params: Promise.resolve({ fileId }) },
      );
      expect(dl.status).toBe(200);
      expect(await dl.text()).toBe("fake-weights-v1");
      expect(dl.headers.get("content-disposition")).toContain("best.pt");

      // List shows latest only; detail selects versions via ?v=.
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

      const missingVersion = await detailGET(
        await authedRequest("/api/v1/x?v=9", org.member),
        detailParams,
      );
      expect(missingVersion.status).toBe(404);
    } finally {
      await org.cleanup();
    }
  });

  it("rejects bad names, empty uploads, dup paths, and strangers", async () => {
    const org = await createTestOrg("art");
    const other = await createTestOrg("artB");
    try {
      const runId = await makeRun(org);

      const badName = await upload(
        org.member,
        { name: "not a valid name!", run_id: runId },
        [{ name: "f.bin", content: "x" }],
      );
      expect(badName.status).toBe(400);

      const empty = await upload(org.member, { name: "w", run_id: runId }, []);
      expect(empty.status).toBe(400);

      const dup = await upload(org.member, { name: "w", run_id: runId }, [
        { name: "same.bin", content: "a" },
        { name: "same.bin", content: "b" },
      ]);
      expect(dup.status).toBe(400);

      const evil = await upload(org.member, { name: "w", run_id: runId }, [
        { name: "../escape.bin", content: "x" },
      ]);
      expect(evil.status).toBe(400);

      const noProject = await upload(org.member, { name: "w" }, [
        { name: "f.bin", content: "x" },
      ]);
      expect(noProject.status).toBe(400);

      // Cross-org: other org's session sees nothing.
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
    } finally {
      await other.cleanup();
      await org.cleanup();
    }
  });
});
