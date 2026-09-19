import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

import { POST as finishPOST } from "@/app/api/v1/runs/[runId]/finish/route";
import { POST as runsPOST } from "@/app/api/v1/runs/route";
import { DELETE as deleteHook } from "@/app/api/v1/projects/[project]/webhooks/[webhookId]/route";
import {
  GET as listHooks,
  POST as createHook,
} from "@/app/api/v1/projects/[project]/webhooks/route";
import { db } from "@/lib/db";
import { apiTestsEnabled, authedRequest, createTestOrg } from "../helpers";

// DNS is stubbed: public-host lookups resolve to example.com without
// touching the network; tests override per-case for rebinding.
let dnsAddrs = ["93.184.216.34"];
vi.mock("node:dns/promises", () => ({
  lookup: async () => dnsAddrs.map((address) => ({ address, family: 4 })),
}));

async function makeRun(session: Parameters<typeof authedRequest>[1]) {
  const made = await runsPOST(
    await authedRequest("/api/v1/runs", session, {
      method: "POST",
      body: { project: "wh", name: "wh-run" },
    }),
  );
  return ((await made.json()) as { run_id: string }).run_id;
}

describe.skipIf(!apiTestsEnabled)("webhook routes", () => {
  it("CRUD: create shows secret once, list hides it, delete works", async () => {
    const org = await createTestOrg("hooks");
    try {
      const created = await createHook(
        await authedRequest("/api/v1/projects/wh/webhooks", org.admin, {
          method: "POST",
          body: {
            url: "https://hooks.example.com/cursus",
            events: ["run.crashed"],
          },
        }),
        { params: Promise.resolve({ project: "wh" }) },
      );
      // Project doesn't exist yet — runs auto-create projects, webhooks don't.
      expect(created.status).toBe(404);
      await makeRun(org.admin);
      const retry = await createHook(
        await authedRequest("/api/v1/projects/wh/webhooks", org.admin, {
          method: "POST",
          body: {
            url: "https://hooks.example.com/cursus",
            events: ["run.crashed"],
          },
        }),
        { params: Promise.resolve({ project: "wh" }) },
      );
      expect(retry.status).toBe(201);
      const { webhook, secret } = (await retry.json()) as {
        webhook: { id: string; url: string; events: string[] };
        secret: string;
      };
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      expect(webhook.events).toEqual(["run.crashed"]);

      const listed = await listHooks(
        await authedRequest("/api/v1/projects/wh/webhooks", org.member),
        { params: Promise.resolve({ project: "wh" }) },
      );
      expect(listed.status).toBe(200);
      expect((await listed.json()) as object).not.toHaveProperty("secret");

      // Member can manage webhooks on org-wide projects.
      const memberMade = await createHook(
        await authedRequest("/api/v1/projects/wh/webhooks", org.member, {
          method: "POST",
          body: {
            url: "https://hooks.example.com/other",
            events: ["run.finished"],
          },
        }),
        { params: Promise.resolve({ project: "wh" }) },
      );
      expect(memberMade.status).toBe(201);

      const del = await deleteHook(
        await authedRequest(
          `/api/v1/projects/wh/webhooks/${webhook.id}`,
          org.admin,
          { method: "DELETE" },
        ),
        { params: Promise.resolve({ project: "wh", webhookId: webhook.id }) },
      );
      expect(del.status).toBe(200);
    } finally {
      await org.cleanup();
    }
  });

  it("rejects SSRF targets, bad events, and over-cap sets", async () => {
    const org = await createTestOrg("hooks");
    try {
      await makeRun(org.admin);
      const bad = async (body: unknown) =>
        (
          await createHook(
            await authedRequest("/api/v1/projects/wh/webhooks", org.admin, {
              method: "POST",
              body,
            }),
            { params: Promise.resolve({ project: "wh" }) },
          )
        ).status;
      expect(
        await bad({ url: "http://localhost:9/x", events: ["run.crashed"] }),
      ).toBe(400);
      expect(
        await bad({ url: "http://127.0.0.1/x", events: ["run.crashed"] }),
      ).toBe(400);
      expect(
        await bad({ url: "http://169.254.169.254/", events: ["run.crashed"] }),
      ).toBe(400);
      expect(
        await bad({ url: "http://10.1.2.3/x", events: ["run.crashed"] }),
      ).toBe(400);
      expect(
        await bad({ url: "ftp://example.com/x", events: ["run.crashed"] }),
      ).toBe(400);
      expect(
        await bad({
          url: "https://user:pw@example.com/",
          events: ["run.crashed"],
        }),
      ).toBe(400);
      expect(
        await bad({ url: "https://hooks.example.com/x", events: ["nope"] }),
      ).toBe(400);
      // DNS rebinding: resolves to loopback → blocked.
      dnsAddrs = ["127.0.0.1"];
      try {
        expect(
          await bad({
            url: "https://evil.example.com/x",
            events: ["run.crashed"],
          }),
        ).toBe(400);
      } finally {
        dnsAddrs = ["93.184.216.34"];
      }
      // Cap: 10 webhooks, 11th is a 409.
      for (let i = 0; i < 10; i++) {
        expect(
          await bad({
            url: `https://hooks.example.com/${i}`,
            events: ["run.finished"],
          }),
        ).toBe(201);
      }
      expect(
        await bad({
          url: "https://hooks.example.com/overflow",
          events: ["run.finished"],
        }),
      ).toBe(409);
    } finally {
      await org.cleanup();
    }
  });

  it("crash dispatches a signed payload; dead endpoints never fail finishes", async () => {
    const org = await createTestOrg("hooks");
    const received: {
      headers: Record<string, string | undefined>;
      body: string;
    }[] = [];
    const server: Server = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        const headers: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          headers[k] = Array.isArray(v) ? v.join(",") : v;
        }
        received.push({ headers, body: data });
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const runId = await makeRun(org.admin);
      const project = await db.project.findUniqueOrThrow({
        where: { orgId_slug: { orgId: org.orgId, slug: "wh" } },
      });
      const secret = "test-secret-hex";
      // Bypass the SSRF-guarded create path: loopback listener only.
      await db.webhook.create({
        data: {
          projectId: project.id,
          url: `http://127.0.0.1:${port}/hook`,
          events: ["run.crashed"],
          secret,
          createdById: org.admin.userId,
        },
      });
      const fin = await finishPOST(
        await authedRequest(`/api/v1/runs/${runId}/finish`, org.admin, {
          method: "POST",
          body: { status: "crashed" },
        }),
        { params: Promise.resolve({ runId }) },
      );
      expect(fin.status).toBe(200);
      expect(received).toHaveLength(1);
      const [first] = received;
      expect(first!.headers["x-cursus-event"]).toBe("run.crashed");
      const payload = JSON.parse(first!.body) as {
        event: string;
        run_id: string;
        project: string;
        status: string;
      };
      expect(payload).toMatchObject({
        event: "run.crashed",
        run_id: runId,
        project: "wh",
        status: "CRASHED",
      });
      expect(first!.headers["x-cursus-signature"]).toBe(
        createHmac("sha256", secret).update(first!.body).digest("hex"),
      );

      // Finished runs don't match a crashed-only subscription.
      const run2 = await makeRun(org.admin);
      await finishPOST(
        await authedRequest(`/api/v1/runs/${run2}/finish`, org.admin, {
          method: "POST",
          body: { status: "finished" },
        }),
        { params: Promise.resolve({ runId: run2 }) },
      );
      expect(received).toHaveLength(1);

      // Dead endpoint: finish still 200s, fast.
      await db.webhook.updateMany({
        where: { projectId: project.id },
        data: { url: "http://127.0.0.1:9/dead" },
      });
      const run3 = await makeRun(org.admin);
      const started = Date.now();
      const fin3 = await finishPOST(
        await authedRequest(`/api/v1/runs/${run3}/finish`, org.admin, {
          method: "POST",
          body: { status: "crashed" },
        }),
        { params: Promise.resolve({ runId: run3 }) },
      );
      expect(fin3.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      server.close();
      await org.cleanup();
    }
  });

  it("cross-org projects 404; invitees see nothing", async () => {
    const a = await createTestOrg("hooksA");
    const b = await createTestOrg("hooksB");
    try {
      await makeRun(a.admin);
      const cross = await listHooks(
        await authedRequest("/api/v1/projects/wh/webhooks", b.admin),
        { params: Promise.resolve({ project: "wh" }) },
      );
      expect(cross.status).toBe(404);
      const stranger = await createHook(
        await authedRequest("/api/v1/projects/wh/webhooks", b.admin, {
          method: "POST",
          body: {
            url: "https://hooks.example.com/x",
            events: ["run.finished"],
          },
        }),
        { params: Promise.resolve({ project: "wh" }) },
      );
      expect(stranger.status).toBe(404);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });
});
