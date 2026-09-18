import { describe, expect, it } from "vitest";

import { POST as runsPOST } from "@/app/api/v1/runs/route";
import { GET as listGET } from "@/app/api/v1/projects/[project]/runs/route";
import {
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
  type TestOrg,
} from "../helpers";

async function seedRuns(org: TestOrg, project: string, names: string[]) {
  const ids: string[] = [];
  for (const name of names) {
    const made = await runsPOST(
      await authedRequest("/api/v1/runs", org.member, {
        method: "POST",
        body: { project, name },
      }),
    );
    expect(made.status).toBe(201);
    ids.push(((await made.json()) as { run_id: string }).run_id);
    // Distinct startedAt values so recency ordering is deterministic.
    await new Promise((r) => setTimeout(r, 15));
  }
  return ids;
}

async function listedNames(
  org: TestOrg,
  project: string,
  query: string,
): Promise<string[]> {
  const res = await listGET(
    await authedRequest(`/api/v1/projects/${project}/runs?${query}`, org.member),
    { params: Promise.resolve({ project }) },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { runs: { name: string }[] };
  return body.runs.map((r) => r.name);
}

describe.skipIf(!apiTestsEnabled)("run list sorting", () => {
  it("orders by recency, age, and name with correct cursors", async () => {
    const org = await createTestOrg("sort");
    try {
      const ids = await seedRuns(org, "p", ["charlie", "alpha", "bravo"]);
      expect(await listedNames(org, "p", "")).toEqual([
        "bravo",
        "alpha",
        "charlie",
      ]);
      expect(await listedNames(org, "p", "sort=oldest")).toEqual([
        "charlie",
        "alpha",
        "bravo",
      ]);
      expect(await listedNames(org, "p", "sort=name_asc")).toEqual([
        "alpha",
        "bravo",
        "charlie",
      ]);
      expect(await listedNames(org, "p", "sort=name_desc")).toEqual([
        "charlie",
        "bravo",
        "alpha",
      ]);

      // Cursor paging under name sort returns the remainder exactly once.
      const page1 = await listGET(
        await authedRequest(
          `/api/v1/projects/p/runs?sort=name_asc&limit=2`,
          org.member,
        ),
        { params: Promise.resolve({ project: "p" }) },
      );
      const b1 = (await page1.json()) as {
        runs: { name: string }[];
        nextCursor: string;
      };
      expect(b1.runs.map((r) => r.name)).toEqual(["alpha", "bravo"]);
      const page2 = await listGET(
        await authedRequest(
          `/api/v1/projects/p/runs?sort=name_asc&limit=2&cursor=${b1.nextCursor}`,
          org.member,
        ),
        { params: Promise.resolve({ project: "p" }) },
      );
      const b2 = (await page2.json()) as {
        runs: { name: string }[];
        nextCursor: string | null;
      };
      expect(b2.runs.map((r) => r.name)).toEqual(["charlie"]);
      expect(b2.nextCursor).toBeNull();
      expect(ids).toHaveLength(3);

      // Unknown sort value → 400.
      const bad = await listGET(
        await authedRequest(`/api/v1/projects/p/runs?sort=chaos`, org.member),
        { params: Promise.resolve({ project: "p" }) },
      );
      expect(bad.status).toBe(400);
    } finally {
      await org.cleanup();
    }
  });
});
