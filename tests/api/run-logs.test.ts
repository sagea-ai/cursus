import { describe, expect, it } from "vitest";

import {
  GET as logsGET,
  POST as logsPOST,
} from "@/app/api/v1/runs/[runId]/logs/route";
import { POST as runsPOST } from "@/app/api/v1/runs/route";
import { db } from "@/lib/db";
import {
  apiRequest,
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
} from "../helpers";

async function makeRun(session: Parameters<typeof authedRequest>[1]) {
  const made = await runsPOST(
    await authedRequest("/api/v1/runs", session, {
      method: "POST",
      body: { project: "lp", name: "log-run" },
    }),
  );
  expect(made.status).toBe(201);
  return ((await made.json()) as { run_id: string }).run_id;
}

describe.skipIf(!apiTestsEnabled)("run log routes", () => {
  it("batches insert; tail pages with cursors; truncates long lines", async () => {
    const org = await createTestOrg("logs");
    try {
      const runId = await makeRun(org.member);
      const lines = Array.from({ length: 5 }, (_, i) => ({
        stream: i % 2 === 0 ? "stdout" : "stderr",
        step: i,
        text: `line-${i}`,
      }));
      const logged = await logsPOST(
        await authedRequest(`/api/v1/runs/${runId}/logs`, org.member, {
          method: "POST",
          body: { lines },
        }),
        { params: Promise.resolve({ runId }) },
      );
      expect(logged.status).toBe(202);
      expect(((await logged.json()) as { logged: number }).logged).toBe(5);

      // Oversize line truncates instead of rejecting.
      const big = await logsPOST(
        await authedRequest(`/api/v1/runs/${runId}/logs`, org.member, {
          method: "POST",
          body: { lines: [{ text: "x".repeat(5000) }] },
        }),
        { params: Promise.resolve({ runId }) },
      );
      expect(big.status).toBe(202);
      const stored = await db.runLog.findFirstOrThrow({
        where: { runId, text: { startsWith: "x".repeat(100) } },
        orderBy: { id: "desc" },
      });
      expect(stored.text.length).toBeLessThanOrEqual(4012);

      // Tail page (limit 2): newest two, chronological, with cursor.
      const tail = await logsGET(
        await authedRequest(`/api/v1/runs/${runId}/logs?limit=2`, org.member),
        { params: Promise.resolve({ runId }) },
      );
      expect(tail.status).toBe(200);
      const tailBody = (await tail.json()) as {
        lines: { text: string }[];
        total: number;
        nextCursor: string | null;
      };
      expect(tailBody.total).toBe(6);
      expect(tailBody.lines.map((l) => l.text)).toEqual([
        "line-4",
        expect.stringMatching(/^x+…\[truncated\]$/),
      ]);
      expect(tailBody.nextCursor).not.toBeNull();

      // Older page via cursor.
      const older = await logsGET(
        await authedRequest(
          `/api/v1/runs/${runId}/logs?limit=10&cursor=${tailBody.nextCursor}`,
          org.member,
        ),
        { params: Promise.resolve({ runId }) },
      );
      const olderBody = (await older.json()) as {
        lines: { text: string }[];
        nextCursor: string | null;
      };
      expect(olderBody.lines.map((l) => l.text)).toEqual([
        "line-0",
        "line-1",
        "line-2",
        "line-3",
      ]);
      expect(olderBody.nextCursor).toBeNull();

      // Stream filter.
      const err = await logsGET(
        await authedRequest(
          `/api/v1/runs/${runId}/logs?stream=stderr`,
          org.member,
        ),
        { params: Promise.resolve({ runId }) },
      );
      const errBody = (await err.json()) as {
        lines: { stream: string }[];
        total: number;
      };
      expect(errBody.total).toBe(2);
      expect(errBody.lines.every((l) => l.stream === "stderr")).toBe(true);
    } finally {
      await org.cleanup();
    }
  });

  it("rejects bad batches, strangers, and capped runs", async () => {
    const org = await createTestOrg("logs");
    const other = await createTestOrg("logsB");
    try {
      const runId = await makeRun(org.member);
      const post = async (body: unknown, session = org.member) =>
        logsPOST(
          await authedRequest(`/api/v1/runs/${runId}/logs`, session, {
            method: "POST",
            body,
          }),
          { params: Promise.resolve({ runId }) },
        );
      expect(await (await post({ lines: [] })).status).toBe(400);
      expect(
        await (
          await post({
            lines: Array.from({ length: 501 }, (_, i) => ({ text: `l${i}` })),
          })
        ).status,
      ).toBe(400);
      expect(
        await (
          await post({ lines: [{ stream: "nope", text: "x" }] })
        ).status,
      ).toBe(400);
      expect(
        (
          await logsPOST(
            await authedRequest(`/api/v1/runs/${runId}/logs`, other.admin, {
              method: "POST",
              body: { lines: [{ text: "x" }] },
            }),
            { params: Promise.resolve({ runId }) },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await logsGET(apiRequest(`/api/v1/runs/${runId}/logs`), {
            params: Promise.resolve({ runId }),
          })
        ).status,
      ).toBe(401);
    } finally {
      await other.cleanup();
      await org.cleanup();
    }
  });
});
