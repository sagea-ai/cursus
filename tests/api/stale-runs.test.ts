import { describe, expect, it } from "vitest";

import { GET as runGET } from "@/app/api/v1/runs/[runId]/route";
import { POST as runsPOST } from "@/app/api/v1/runs/route";
import { db } from "@/lib/db";
import { listRuns, STALE_RUN_MINUTES } from "@/lib/runs";
import {
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
  type TestOrg,
} from "../helpers";

async function makeRun(org: TestOrg, project: string, name: string) {
  const made = await runsPOST(
    await authedRequest("/api/v1/runs", org.member, {
      method: "POST",
      body: { project, name },
    }),
  );
  expect(made.status).toBe(201);
  return ((await made.json()) as { run_id: string }).run_id;
}

async function backdate(runId: string, minutesAgo: number) {
  await db.run.update({
    where: { id: runId },
    data: { updatedAt: new Date(Date.now() - minutesAgo * 60_000) },
  });
}

describe.skipIf(!apiTestsEnabled)("stale-run detection", () => {
  it("listRuns flips silent RUNNING runs to CRASHED", async () => {
    const org = await createTestOrg("stale");
    try {
      const dead = await makeRun(org, "p", "dead");
      const alive = await makeRun(org, "p", "alive");
      const done = await makeRun(org, "p", "done");
      await backdate(dead, STALE_RUN_MINUTES + 5);
      await backdate(done, STALE_RUN_MINUTES + 60);
      await db.run.update({
        where: { id: done },
        data: { status: "FINISHED", finishedAt: new Date() },
      });

      const { runs } = await listRuns(org.member, "p", { limit: 50 });
      const byId = Object.fromEntries(runs.map((r) => [r.id, r]));
      expect(byId[dead]!.status).toBe("CRASHED");
      expect(byId[dead]!.finishedAt).not.toBeNull();
      expect(byId[alive]!.status).toBe("RUNNING");
      expect(byId[done]!.status).toBe("FINISHED");

      // Persisted, not just projected.
      const row = await db.run.findUnique({ where: { id: dead } });
      expect(row!.status).toBe("CRASHED");
    } finally {
      await org.cleanup();
    }
  });

  it("getRun flips a single stale run", async () => {
    const org = await createTestOrg("stale");
    try {
      const runId = await makeRun(org, "p", "solo");
      await backdate(runId, STALE_RUN_MINUTES + 1);
      const res = await runGET(
        await authedRequest(`/api/v1/runs/${runId}`, org.member),
        { params: Promise.resolve({ runId }) },
      );
      expect(res.status).toBe(200);
      expect(((await res.json()).run as { status: string }).status).toBe(
        "CRASHED",
      );
    } finally {
      await org.cleanup();
    }
  });

  it("runs just under the threshold stay RUNNING", async () => {
    const org = await createTestOrg("stale");
    try {
      const runId = await makeRun(org, "p", "fresh");
      await backdate(runId, STALE_RUN_MINUTES - 1);
      const { runs } = await listRuns(org.member, "p", { limit: 50 });
      expect(runs.find((r) => r.id === runId)!.status).toBe("RUNNING");
    } finally {
      await org.cleanup();
    }
  });

  it("one org's reads never flip another org's runs", async () => {
    const a = await createTestOrg("staleA");
    const b = await createTestOrg("staleB");
    try {
      const bRun = await makeRun(b, "p", "b-run");
      await backdate(bRun, STALE_RUN_MINUTES + 30);
      await makeRun(a, "p", "a-run");
      await listRuns(a.member, "p", { limit: 50 });
      const row = await db.run.findUnique({ where: { id: bRun } });
      expect(row!.status).toBe("RUNNING");
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });
});
