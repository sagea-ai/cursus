import { describe, expect, it } from "vitest";

import { POST as logPOST } from "@/app/api/v1/runs/[runId]/log/route";
import { POST as runsPOST } from "@/app/api/v1/runs/route";
import { POST as archivePOST } from "@/app/api/v1/orgs/[orgSlug]/projects/[projectSlug]/archive/route";
import { POST as purgePOST } from "@/app/api/v1/orgs/[orgSlug]/projects/[projectSlug]/purge/route";
import { POST as retentionPOST } from "@/app/api/v1/orgs/[orgSlug]/projects/[projectSlug]/retention/route";
import { db } from "@/lib/db";
import { apiTestsEnabled, authedRequest, createTestOrg } from "../helpers";

async function makeRun(
  session: Parameters<typeof authedRequest>[1],
  name = "ret-run",
  project = "ret",
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
          key: "k",
          step: i,
          value: i,
        })),
      },
    }),
    { params: Promise.resolve({ runId }) },
  );
  expect(res.status).toBe(202);
}

describe.skipIf(!apiTestsEnabled)("retention routes", () => {
  it("TTL validates; archive freezes writes; purge is dry-run safe", async () => {
    const org = await createTestOrg("ret");
    try {
      const runId = await makeRun(org.member);
      await logPoints(org.member, runId, 3);
      // Backdate two points past a 7-day TTL.
      const old = new Date(Date.now() - 10 * 86_400_000);
      await db.metric.updateMany({
        where: { runId, step: { lt: 2 } },
        data: { wallTime: old },
      });

      const base = `/api/v1/orgs/${org.orgSlug}/projects/ret`;
      const params = {
        params: Promise.resolve({ orgSlug: org.orgSlug, projectSlug: "ret" }),
      };
      const call = async (
        leaf: "retention" | "archive" | "purge",
        body: unknown,
        session = org.admin,
      ) => {
        const req = await authedRequest(`${base}/${leaf}`, session, {
          method: "POST",
          body,
        });
        if (leaf === "retention") return retentionPOST(req, params);
        if (leaf === "archive") return archivePOST(req, params);
        return purgePOST(req, params);
      };

      expect((await call("retention", { metricsTtlDays: 0 })).status).toBe(400);
      expect((await call("retention", { metricsTtlDays: 4000 })).status).toBe(
        400,
      );
      expect((await call("retention", { metricsTtlDays: 7 })).status).toBe(200);

      // Purge without TTL is a 400 — tested on a second project.
      await makeRun(org.member, "other-run", "ret2");
      expect(
        (
          await purgePOST(
            await authedRequest(
              `/api/v1/orgs/${org.orgSlug}/projects/ret2/purge`,
              org.admin,
              { method: "POST", body: { dryRun: true } },
            ),
            {
              params: Promise.resolve({
                orgSlug: org.orgSlug,
                projectSlug: "ret2",
              }),
            },
          )
        ).status,
      ).toBe(400);

      // Dry run counts without deleting.
      const dry = await call("purge", { dryRun: true });
      expect(dry.status).toBe(200);
      expect(((await dry.json()) as { deleted: number }).deleted).toBe(2);
      expect(await db.metric.count({ where: { runId } })).toBe(3);

      // Archive freezes content writes but not reads/purge.
      expect((await call("archive", { archived: true })).status).toBe(200);
      const blocked = await logPOST(
        await authedRequest(`/api/v1/runs/${runId}/log`, org.member, {
          method: "POST",
          body: { points: [{ key: "k", step: 9, value: 1 }] },
        }),
        { params: Promise.resolve({ runId }) },
      );
      expect(blocked.status).toBe(409);
      const blockedCreate = await runsPOST(
        await authedRequest("/api/v1/runs", org.member, {
          method: "POST",
          body: { project: "ret", name: "nope" },
        }),
      );
      expect(blockedCreate.status).toBe(409);

      // Real purge deletes old points; run + summary + fresh point survive.
      const real = await call("purge", {});
      expect(real.status).toBe(200);
      expect(((await real.json()) as { deleted: number }).deleted).toBe(2);
      expect(await db.metric.count({ where: { runId } })).toBe(1);
      const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
      expect((run.summary as Record<string, number>)["k"]).toBe(2);

      // Unarchive restores writes.
      expect((await call("archive", { archived: false })).status).toBe(200);
      await logPoints(org.member, runId, 1);

      // Members cannot touch retention.
      const forbidden = await call("archive", { archived: true }, org.member);
      expect(forbidden.status).toBe(403);
    } finally {
      await org.cleanup();
    }
  });
});
