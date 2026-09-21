import { describe, expect, it } from "vitest";

import { GET as chartGET } from "@/app/api/v1/projects/[project]/chart/route";
import { POST as logPOST } from "@/app/api/v1/runs/[runId]/log/route";
import { POST as runsPOST } from "@/app/api/v1/runs/route";
import {
  apiRequest,
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
} from "../helpers";

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
  n: number,
) {
  const res = await logPOST(
    await authedRequest(`/api/v1/runs/${runId}/log`, session, {
      method: "POST",
      body: {
        points: Array.from({ length: n }, (_, i) => ({
          key: "train/loss",
          step: i,
          value: 1 / (i + 1),
        })),
      },
    }),
    { params: Promise.resolve({ runId }) },
  );
  expect(res.status).toBe(202);
}

describe.skipIf(!apiTestsEnabled)("overlay chart", () => {
  it("batches series per run, downsampled and bounded", async () => {
    const org = await createTestOrg("overlay");
    try {
      const a = await makeRun(org.member, "op", "oa");
      await logPoints(org.member, a, 10);
      const b = await makeRun(org.member, "op", "ob");
      await logPoints(org.member, b, 4);

      const res = await chartGET(
        await authedRequest(
          `/api/v1/projects/op/chart?key=train%2Floss&runs=${a},${b}&max_points=5`,
          org.member,
        ),
        { params: Promise.resolve({ project: "op" }) },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        key: string;
        series: { runId: string; name: string; points: { step: number }[] }[];
      };
      expect(body.key).toBe("train/loss");
      expect(body.series.map((s) => s.name).sort()).toEqual(["oa", "ob"]);
      const byName = new Map(body.series.map((s) => [s.name, s]));
      // Downsampled to budget, last point always kept.
      expect(byName.get("oa")!.points).toHaveLength(5);
      expect(byName.get("oa")!.points.at(-1)!.step).toBe(9);
      expect(byName.get("ob")!.points).toHaveLength(4);

      // Missing key → empty series, not an error.
      const empty = await chartGET(
        await authedRequest(
          `/api/v1/projects/op/chart?key=nope&runs=${a}`,
          org.member,
        ),
        { params: Promise.resolve({ project: "op" }) },
      );
      expect(
        ((await empty.json()) as { series: { points: unknown[] }[] }).series[0]!
          .points,
      ).toEqual([]);
    } finally {
      await org.cleanup();
    }
  });

  it("rejects hidden ids wholesale, caps runs, gates auth", async () => {
    const org = await createTestOrg("overlay");
    const other = await createTestOrg("overlayB");
    try {
      const a = await makeRun(org.member, "op", "oa");
      await logPoints(org.member, a, 2);
      const outsider = await makeRun(other.admin, "op", "foreign");

      // One hidden id fails the whole batch (no partial series).
      const partial = await chartGET(
        await authedRequest(
          `/api/v1/projects/op/chart?key=train%2Floss&runs=${a},${outsider}`,
          org.member,
        ),
        { params: Promise.resolve({ project: "op" }) },
      );
      expect(partial.status).toBe(404);

      const eleven = await chartGET(
        await authedRequest(
          `/api/v1/projects/op/chart?key=k&runs=${Array.from({ length: 11 }, (_, i) => `x${i}`).join(",")}`,
          org.member,
        ),
        { params: Promise.resolve({ project: "op" }) },
      );
      expect(eleven.status).toBe(400);

      const anon = await chartGET(
        apiRequest(`/api/v1/projects/op/chart?key=k&runs=${a}`),
        { params: Promise.resolve({ project: "op" }) },
      );
      expect(anon.status).toBe(401);

      const missing = await chartGET(
        await authedRequest(
          "/api/v1/projects/nope/chart?key=k&runs=a",
          org.admin,
        ),
        { params: Promise.resolve({ project: "nope" }) },
      );
      expect(missing.status).toBe(404);
    } finally {
      await other.cleanup();
      await org.cleanup();
    }
  });
});
