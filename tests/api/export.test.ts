import { describe, expect, it } from "vitest";

import { GET as exportGET } from "@/app/api/v1/runs/[runId]/export/route";
import { GET as projectExportGET } from "@/app/api/v1/projects/[project]/export/route";
import { POST as logPOST } from "@/app/api/v1/runs/[runId]/log/route";
import { POST as runsPOST } from "@/app/api/v1/runs/route";
import { EXPORT_BATCH_SIZE } from "@/lib/export";
import {
  apiRequest,
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
} from "../helpers";

async function makeRun(
  org: { member: Parameters<typeof authedRequest>[1] },
  name: string,
): Promise<string> {
  const made = await runsPOST(
    await authedRequest("/api/v1/runs", org.member, {
      method: "POST",
      body: { project: "export-proj", name },
    }),
  );
  expect(made.status).toBe(201);
  return ((await made.json()) as { run_id: string }).run_id;
}

async function logPoints(
  session: Parameters<typeof authedRequest>[1],
  runId: string,
  key: string,
  n: number,
): Promise<void> {
  // The log endpoint caps batches at 1000 points — chunk like the SDK does.
  for (let start = 0; start < n; start += 1000) {
    const end = Math.min(start + 1000, n);
    const points = Array.from({ length: end - start }, (_, i) => ({
      key,
      step: start + i,
      value: start + i + 0.5,
    }));
    const res = await logPOST(
      await authedRequest(`/api/v1/runs/${runId}/log`, session, {
        method: "POST",
        body: { points },
      }),
      { params: Promise.resolve({ runId }) },
    );
    expect(res.status).toBe(202);
  }
}

describe.skipIf(!apiTestsEnabled)("export routes", () => {
  it("CSV exports all keys in insertion order with a header", async () => {
    const org = await createTestOrg("exp");
    try {
      const runId = await makeRun(org, "csv-run");
      await logPoints(org.member, runId, "train/loss", 3);
      await logPoints(org.member, runId, "eval/acc", 2);

      const res = await exportGET(
        await authedRequest(
          `/api/v1/runs/${runId}/export?format=csv`,
          org.member,
        ),
        { params: Promise.resolve({ runId }) },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/csv");
      expect(res.headers.get("content-disposition")).toMatch(
        /attachment; filename="cursus-csv-run-metrics\.csv"/,
      );
      const lines = (await res.text()).trim().split("\n");
      expect(lines[0]).toBe("key,step,value,wall_time");
      expect(lines).toHaveLength(1 + 5);
      expect(lines[1]).toMatch(/^train\/loss,0,0\.5,/);
      expect(lines[4]).toMatch(/^eval\/acc,0,0\.5,/);
      expect(lines[5]).toMatch(/^eval\/acc,1,1\.5,/);
    } finally {
      await org.cleanup();
    }
  });

  it("JSON envelope validates; key filter scopes rows", async () => {
    const org = await createTestOrg("exp");
    try {
      const runId = await makeRun(org, "json-run");
      await logPoints(org.member, runId, "train/loss", 2);
      await logPoints(org.member, runId, "eval/acc", 2);

      const res = await exportGET(
        await authedRequest(
          `/api/v1/runs/${runId}/export?format=json&key=train%2Floss`,
          org.member,
        ),
        { params: Promise.resolve({ runId }) },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const body = (await res.json()) as {
        run_id: string;
        exported_at: string;
        points: {
          key: string;
          step: number;
          value: number;
          wall_time: string;
        }[];
      };
      expect(body.run_id).toBe(runId);
      expect(body.points).toHaveLength(2);
      expect(body.points.every((p) => p.key === "train/loss")).toBe(true);
      expect(body.points[0]).toMatchObject({ step: 0, value: 0.5 });
    } finally {
      await org.cleanup();
    }
  });

  it("streams past the batch boundary without loss", async () => {
    const org = await createTestOrg("exp");
    try {
      const runId = await makeRun(org, "big-run");
      await logPoints(org.member, runId, "train/loss", EXPORT_BATCH_SIZE + 100);

      const res = await exportGET(
        await authedRequest(
          `/api/v1/runs/${runId}/export?format=json`,
          org.member,
        ),
        { params: Promise.resolve({ runId }) },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { points: unknown[] };
      expect(body.points).toHaveLength(EXPORT_BATCH_SIZE + 100);
    } finally {
      await org.cleanup();
    }
  });

  it("project export streams every visible run; key filter + subset hold", async () => {
    const org = await createTestOrg("exp");
    try {
      const r1 = await makeRun(org, "p1-a");
      await logPoints(org.member, r1, "train/loss", 3);
      const r2 = await makeRun(org, "p1-b");
      await logPoints(org.member, r2, "train/loss", 2);
      await logPoints(org.member, r2, "eval/acc", 1);

      const csv = await projectExportGET(
        await authedRequest(
          "/api/v1/projects/export-proj/export?format=csv",
          org.member,
        ),
        { params: Promise.resolve({ project: "export-proj" }) },
      );
      expect(csv.status).toBe(200);
      expect(csv.headers.get("content-disposition")).toMatch(
        /attachment; filename="cursus-export-proj-metrics\.csv"/,
      );
      const lines = (await csv.text()).trim().split("\n");
      expect(lines[0]).toBe("run_id,run_name,key,step,value,wall_time");
      expect(lines).toHaveLength(1 + 6);

      const json = await projectExportGET(
        await authedRequest(
          "/api/v1/projects/export-proj/export?format=json&key=train%2Floss",
          org.member,
        ),
        { params: Promise.resolve({ project: "export-proj" }) },
      );
      expect(json.status).toBe(200);
      const body = (await json.json()) as {
        project: string;
        runs: { run_id: string; points: { key: string }[] }[];
      };
      expect(body.project).toBe("export-proj");
      expect(body.runs).toHaveLength(2);
      expect(body.runs.flatMap((r) => r.points)).toHaveLength(5);
      expect(
        body.runs.every((r) => r.points.every((p) => p.key === "train/loss")),
      ).toBe(true);

      const anon = await projectExportGET(
        apiRequest("/api/v1/projects/export-proj/export"),
        { params: Promise.resolve({ project: "export-proj" }) },
      );
      expect(anon.status).toBe(401);

      const missing = await projectExportGET(
        await authedRequest("/api/v1/projects/nope/export", org.admin),
        { params: Promise.resolve({ project: "nope" }) },
      );
      expect(missing.status).toBe(404);
    } finally {
      await org.cleanup();
    }
  });

  it("project export hides grouped runs from outsiders", async () => {
    const org = await createTestOrg("exp");
    try {
      const { POST: groupsPOST } = await import("@/app/api/v1/groups/route");
      await groupsPOST(
        await authedRequest("/api/v1/groups", org.admin, {
          method: "POST",
          body: { name: "G" },
        }),
      );
      // Grouped project (admin bypasses membership); member is an outsider.
      const rin = await runsPOST(
        await authedRequest("/api/v1/runs", org.admin, {
          method: "POST",
          body: { project: "gated", name: "r-in", group: "g" },
        }),
      );
      expect(rin.status).toBe(201);
      const inId = ((await rin.json()) as { run_id: string }).run_id;
      await logPoints(org.admin, inId, "k", 2);

      const res = await projectExportGET(
        await authedRequest(
          "/api/v1/projects/gated/export?format=json",
          org.admin,
        ),
        { params: Promise.resolve({ project: "gated" }) },
      );
      expect(res.status).toBe(200);
      expect(
        ((await res.json()) as { runs: { points: unknown[] }[] }).runs,
      ).toHaveLength(1);

      const dark = await projectExportGET(
        await authedRequest(
          "/api/v1/projects/gated/export?format=json",
          org.member,
        ),
        { params: Promise.resolve({ project: "gated" }) },
      );
      expect(dark.status).toBe(404);
    } finally {
      await org.cleanup();
    }
  });

  it("rejects unknown runs, cross-org access, and anonymous callers", async () => {
    const a = await createTestOrg("expA");
    const b = await createTestOrg("expB");
    try {
      const runId = await makeRun(b, "other-org-run");

      const anon = await exportGET(apiRequest(`/api/v1/runs/${runId}/export`), {
        params: Promise.resolve({ runId }),
      });
      expect(anon.status).toBe(401);

      const cross = await exportGET(
        await authedRequest(`/api/v1/runs/${runId}/export`, a.admin),
        { params: Promise.resolve({ runId }) },
      );
      expect(cross.status).toBe(404);

      const missing = await exportGET(
        await authedRequest("/api/v1/runs/nope/export", b.admin),
        { params: Promise.resolve({ runId: "nope" }) },
      );
      expect(missing.status).toBe(404);

      const badFormat = await exportGET(
        await authedRequest(`/api/v1/runs/${runId}/export?format=xml`, b.admin),
        { params: Promise.resolve({ runId }) },
      );
      expect(badFormat.status).toBe(400);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });
});
