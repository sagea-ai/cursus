import { describe, expect, it } from "vitest";

import { POST as runsPOST } from "@/app/api/v1/runs/route";
import { POST as nextPOST } from "@/app/api/v1/sweeps/[id]/next/route";
import { GET as sweepGET } from "@/app/api/v1/sweeps/[id]/route";
import { POST as statePOST } from "@/app/api/v1/sweeps/[id]/state/route";
import {
  GET as listSweepsGET,
  POST as createSweepPOST,
} from "@/app/api/v1/projects/[project]/sweeps/route";
import { db } from "@/lib/db";
import { apiTestsEnabled, authedRequest, createTestOrg } from "../helpers";

async function createSweep(
  session: Parameters<typeof authedRequest>[1],
  project: string,
  body: unknown,
) {
  const res = await createSweepPOST(
    await authedRequest(`/api/v1/projects/${project}/sweeps`, session, {
      method: "POST",
      body,
    }),
    { params: Promise.resolve({ project }) },
  );
  return res;
}

describe.skipIf(!apiTestsEnabled)("sweep routes", () => {
  it("validates space; grid claims in order then exhausts", async () => {
    const org = await createTestOrg("sweep");
    try {
      const bad = await createSweep(org.admin, "sw", {
        name: "bad",
        method: "GRID",
        space: { lr: { min: 0.1, max: 1 } },
      });
      expect(bad.status).toBe(400);
      const empty = await createSweep(org.admin, "sw", {
        name: "empty",
        method: "RANDOM",
        space: {},
      });
      expect(empty.status).toBe(400);

      const ok = await createSweep(org.admin, "sw", {
        name: "grid-2x2",
        method: "GRID",
        space: { lr: { values: [0.1, 0.2] }, bs: { values: [16, 32] } },
      });
      expect(ok.status).toBe(201);
      const { id } = (await ok.json()) as { id: string };

      const listed = await listSweepsGET(
        await authedRequest("/api/v1/projects/sw/sweeps", org.member),
        { params: Promise.resolve({ project: "sw" }) },
      );
      expect(listed.status).toBe(200);
      expect(
        ((await listed.json()) as { sweeps: { id: string }[] }).sweeps.map(
          (s) => s.id,
        ),
      ).toContain(id);

      const seen: string[] = [];
      for (let i = 0; i < 4; i++) {
        const next = await nextPOST(
          await authedRequest(`/api/v1/sweeps/${id}/next`, org.member, {
            method: "POST",
          }),
          { params: Promise.resolve({ id }) },
        );
        expect(next.status).toBe(200);
        const trial = (await next.json()) as {
          trial: number;
          config: Record<string, number>;
        };
        seen.push(`${trial.config.lr}:${trial.config.bs}`);
      }
      expect(seen.sort()).toEqual(["0.1:16", "0.1:32", "0.2:16", "0.2:32"]);

      const exhausted = await nextPOST(
        await authedRequest(`/api/v1/sweeps/${id}/next`, org.member, {
          method: "POST",
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(exhausted.status).toBe(204);

      // Link runs to the sweep; detail lists them.
      const made = await runsPOST(
        await authedRequest("/api/v1/runs", org.member, {
          method: "POST",
          body: { project: "sw", name: "trial-0", sweep_id: id },
        }),
      );
      expect(made.status).toBe(201);
      const detail = await sweepGET(
        await authedRequest(`/api/v1/sweeps/${id}`, org.member),
        { params: Promise.resolve({ id }) },
      );
      expect(detail.status).toBe(200);
      const body = (await detail.json()) as {
        sweep: { runCount: number };
        runs: { name: string }[];
      };
      expect(body.sweep.runCount).toBe(1);
      expect(body.runs.map((r) => r.name)).toEqual(["trial-0"]);
    } finally {
      await org.cleanup();
    }
  });

  it("concurrent grid claims never double-issue", async () => {
    const org = await createTestOrg("sweep");
    try {
      const ok = await createSweep(org.admin, "sw", {
        name: "race",
        method: "GRID",
        space: { x: { values: [1, 2, 3, 4, 5, 6, 7, 8] } },
      });
      const { id } = (await ok.json()) as { id: string };
      const results = await Promise.all(
        Array.from({ length: 8 }, async () =>
          nextPOST(
            await authedRequest(`/api/v1/sweeps/${id}/next`, org.member, {
              method: "POST",
            }),
            { params: Promise.resolve({ id }) },
          ).then(async (r) =>
            r.status === 200
              ? ((await r.json()) as { trial: number }).trial
              : -1,
          ),
        ),
      );
      expect(results.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    } finally {
      await org.cleanup();
    }
  });

  it("random samples bounds; cancel stops claims; bad links rejected", async () => {
    const org = await createTestOrg("sweep");
    try {
      const ok = await createSweep(org.admin, "sw", {
        name: "rand",
        method: "RANDOM",
        space: {
          lr: { min: 0.01, max: 1, scale: "log" },
          opt: { values: ["a", "b"] },
        },
      });
      const { id } = (await ok.json()) as { id: string };
      for (let i = 0; i < 5; i++) {
        const next = await nextPOST(
          await authedRequest(`/api/v1/sweeps/${id}/next`, org.member, {
            method: "POST",
          }),
          { params: Promise.resolve({ id }) },
        );
        expect(next.status).toBe(200);
        const { config } = (await next.json()) as {
          config: { lr: number; opt: string };
        };
        expect(config.lr).toBeGreaterThanOrEqual(0.01);
        expect(config.lr).toBeLessThanOrEqual(1);
        expect(["a", "b"]).toContain(config.opt);
      }

      const cancel = await statePOST(
        await authedRequest(`/api/v1/sweeps/${id}/state`, org.admin, {
          method: "POST",
          body: { state: "CANCELLED" },
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(cancel.status).toBe(200);
      const after = await nextPOST(
        await authedRequest(`/api/v1/sweeps/${id}/next`, org.member, {
          method: "POST",
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(after.status).toBe(204);

      // Linking to a dead sweep is a 409; unknown sweep is a 400.
      const dead = await runsPOST(
        await authedRequest("/api/v1/runs", org.member, {
          method: "POST",
          body: { project: "sw", name: "late", sweep_id: id },
        }),
      );
      expect(dead.status).toBe(409);
      const ghost = await runsPOST(
        await authedRequest("/api/v1/runs", org.member, {
          method: "POST",
          body: { project: "sw", name: "ghost", sweep_id: "nope" },
        }),
      );
      expect(ghost.status).toBe(400);
    } finally {
      await org.cleanup();
    }
  });

  it("cross-org sweeps 404; anon 401", async () => {
    const a = await createTestOrg("sweepA");
    const b = await createTestOrg("sweepB");
    try {
      const ok = await createSweep(a.admin, "sw", {
        name: "s",
        method: "RANDOM",
        space: { x: { values: [1, 2] } },
      });
      const { id } = (await ok.json()) as { id: string };
      const cross = await sweepGET(
        await authedRequest(`/api/v1/sweeps/${id}`, b.admin),
        { params: Promise.resolve({ id }) },
      );
      expect(cross.status).toBe(404);
      const { apiRequest } = await import("../helpers");
      const anon = await sweepGET(apiRequest(`/api/v1/sweeps/${id}`), {
        params: Promise.resolve({ id }),
      });
      expect(anon.status).toBe(401);
      expect(
        await db.sweep.count({ where: { project: { orgId: a.orgId } } }),
      ).toBe(1);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });
});
