import { describe, expect, it } from "vitest";

import { PATCH as configPATCH } from "@/app/api/v1/runs/[runId]/config/route";
import { POST as finishPOST } from "@/app/api/v1/runs/[runId]/finish/route";
import { POST as runsPOST } from "@/app/api/v1/runs/route";
import { apiTestsEnabled, authedRequest, createTestOrg } from "../helpers";

describe.skipIf(!apiTestsEnabled)("run config sync", () => {
  it("deep-merges, enforces caps and frozen-after-finish, gates roles", async () => {
    const org = await createTestOrg("cfg");
    try {
      const made = await runsPOST(
        await authedRequest("/api/v1/runs", org.member, {
          method: "POST",
          body: {
            project: "cp",
            name: "cfg-run",
            config: { lr: 0.1, nested: { a: 1, b: 2 }, drop: true },
          },
        }),
      );
      const runId = ((await made.json()) as { run_id: string }).run_id;
      const patch = async (body: unknown, session = org.member) =>
        configPATCH(
          await authedRequest(`/api/v1/runs/${runId}/config`, session, {
            method: "PATCH",
            body,
          }),
          { params: Promise.resolve({ runId }) },
        );

      const res = await patch({
        config: { lr: 0.2, nested: { b: 3, c: 4 }, added: [1] },
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { config: unknown }).config).toEqual({
        lr: 0.2,
        nested: { a: 1, b: 3, c: 4 },
        drop: true,
        added: [1],
      });

      const tooMany = await patch({
        config: Object.fromEntries(
          Array.from({ length: 101 }, (_, i) => [`k${i}`, i]),
        ),
      });
      expect(tooMany.status).toBe(400);
      const tooBig = await patch({ config: { blob: "x".repeat(33 * 1024) } });
      expect(tooBig.status).toBe(400);

      await finishPOST(
        await authedRequest(`/api/v1/runs/${runId}/finish`, org.member, {
          method: "POST",
          body: { status: "finished" },
        }),
        { params: Promise.resolve({ runId }) },
      );
      const frozen = await patch({ config: { lr: 0.9 } });
      expect(frozen.status).toBe(409);
    } finally {
      await org.cleanup();
    }
  });
});
