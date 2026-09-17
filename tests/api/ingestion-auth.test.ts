import { describe, expect, it } from "vitest";

import { POST as runsPOST } from "@/app/api/v1/runs/route";
import { GET as metricsGET } from "@/app/api/v1/runs/[runId]/metrics/route";
import { db } from "@/lib/db";
import { generateApiKey } from "@/lib/auth";
import {
  apiRequest,
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
} from "../helpers";

// M2.4 regression: ingestion/read routes accept EITHER a session cookie
// (dashboard) or a Bearer key (SDK) — PRD §6, two modes on one surface.
describe.skipIf(!apiTestsEnabled)("ingestion auth modes", () => {
  it("session cookie creates runs; no auth → 401; bad key → 401", async () => {
    const org = await createTestOrg("ingauth");
    try {
      const viaSession = await runsPOST(
        await authedRequest("/api/v1/runs", org.member, {
          method: "POST",
          body: { project: "via-session" },
        }),
      );
      expect(viaSession.status).toBe(201);

      const anon = await runsPOST(
        apiRequest("/api/v1/runs", {
          method: "POST",
          body: { project: "x" },
        }),
      );
      expect(anon.status).toBe(401);

      const badKey = await runsPOST(
        apiRequest("/api/v1/runs", {
          method: "POST",
          body: { project: "x" },
          apiKey: "cursus_this-key-does-not-exist",
        }),
      );
      expect(badKey.status).toBe(401);
    } finally {
      await org.cleanup();
    }
  });

  it("cross-org run access via session → 404", async () => {
    const a = await createTestOrg("ingA");
    const b = await createTestOrg("ingB");
    try {
      const { plaintext, keyHash } = generateApiKey();
      await db.apiKey.create({
        data: {
          orgId: b.orgId,
          userId: b.admin.userId,
          keyHash,
          label: "k",
        },
      });
      const made = await runsPOST(
        apiRequest("/api/v1/runs", {
          method: "POST",
          body: { project: "b-proj" },
          apiKey: plaintext,
        }),
      );
      const runId = ((await made.json()) as { run_id: string }).run_id;

      // A's session asking for B's run metrics → 404, not a leak.
      const res = await metricsGET(
        await authedRequest(`/api/v1/runs/${runId}/metrics?key=k`, a.admin),
        { params: Promise.resolve({ runId }) },
      );
      expect(res.status).toBe(404);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });
});
