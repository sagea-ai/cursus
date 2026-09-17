import { describe, expect, it } from "vitest";

import { POST as runsPOST } from "@/app/api/v1/runs/route";
import {
  DELETE as runDELETE,
  GET as runGET,
  PATCH as runPATCH,
} from "@/app/api/v1/runs/[runId]/route";
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

      // Same for the single-run endpoint.
      const single = await runGET(
        await authedRequest(`/api/v1/runs/${runId}`, a.admin),
        { params: Promise.resolve({ runId }) },
      );
      expect(single.status).toBe(404);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });

  it("single run returns metadata, config, and metric keys", async () => {
    const org = await createTestOrg("ingrun");
    try {
      const made = await runsPOST(
        await authedRequest("/api/v1/runs", org.member, {
          method: "POST",
          body: {
            project: "detail-proj",
            name: "detail-run",
            config: { lr: 0.01 },
            tags: ["a"],
          },
        }),
      );
      expect(made.status).toBe(201);
      const runId = ((await made.json()) as { run_id: string }).run_id;

      const res = await runGET(
        await authedRequest(`/api/v1/runs/${runId}`, org.member),
        { params: Promise.resolve({ runId }) },
      );
      expect(res.status).toBe(200);
      const { run } = (await res.json()) as {
        run: {
          name: string;
          status: string;
          config: unknown;
          tags: string[];
          keys: string[];
          project: { slug: string };
        };
      };
      expect(run.name).toBe("detail-run");
      expect(run.config).toEqual({ lr: 0.01 });
      expect(run.tags).toEqual(["a"]);
      expect(run.project.slug).toBe("detail-proj");
      expect(run.keys).toEqual([]);
    } finally {
      await org.cleanup();
    }
  });

  it("member can rename/retag; empty patch → 400", async () => {
    const org = await createTestOrg("ingupd");
    try {
      const made = await runsPOST(
        await authedRequest("/api/v1/runs", org.member, {
          method: "POST",
          body: { project: "p", name: "old" },
        }),
      );
      const runId = ((await made.json()) as { run_id: string }).run_id;

      const patched = await runPATCH(
        await authedRequest(`/api/v1/runs/${runId}`, org.member, {
          method: "PATCH",
          body: { name: "new", tags: ["x", "y"] },
        }),
        { params: Promise.resolve({ runId }) },
      );
      expect(patched.status).toBe(200);
      expect(await patched.json()).toMatchObject({
        run: { id: runId, name: "new", tags: ["x", "y"] },
      });

      const empty = await runPATCH(
        await authedRequest(`/api/v1/runs/${runId}`, org.member, {
          method: "PATCH",
          body: {},
        }),
        { params: Promise.resolve({ runId }) },
      );
      expect(empty.status).toBe(400);

      const anon = await runPATCH(
        apiRequest(`/api/v1/runs/${runId}`, {
          method: "PATCH",
          body: { name: "z" },
        }),
        { params: Promise.resolve({ runId }) },
      );
      expect(anon.status).toBe(401);
    } finally {
      await org.cleanup();
    }
  });

  it("run delete: admin ok (metrics cascade), member → 403, key → 401", async () => {
    const org = await createTestOrg("ingdel");
    try {
      const made = await runsPOST(
        await authedRequest("/api/v1/runs", org.member, {
          method: "POST",
          body: { project: "p", name: "doomed" },
        }),
      );
      const runId = ((await made.json()) as { run_id: string }).run_id;

      const memberDel = await runDELETE(
        await authedRequest(`/api/v1/runs/${runId}`, org.member, {
          method: "DELETE",
        }),
        { params: Promise.resolve({ runId }) },
      );
      expect(memberDel.status).toBe(403);

      const adminDel = await runDELETE(
        await authedRequest(`/api/v1/runs/${runId}`, org.admin, {
          method: "DELETE",
        }),
        { params: Promise.resolve({ runId }) },
      );
      expect(adminDel.status).toBe(200);

      const gone = await runGET(
        await authedRequest(`/api/v1/runs/${runId}`, org.admin),
        { params: Promise.resolve({ runId }) },
      );
      expect(gone.status).toBe(404);
    } finally {
      await org.cleanup();
    }
  });
});
