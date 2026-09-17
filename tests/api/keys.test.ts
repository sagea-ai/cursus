import { describe, expect, it } from "vitest";

import { POST as logPOST } from "@/app/api/v1/runs/[runId]/log/route";
import { GET as listGET, POST as createPOST } from "@/app/api/v1/keys/route";
import { DELETE as revokeDELETE } from "@/app/api/v1/keys/[keyId]/route";
import { POST as runsPOST } from "@/app/api/v1/runs/route";
import {
  apiRequest,
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
} from "../helpers";

describe.skipIf(!apiTestsEnabled)("keys routes", () => {
  it("create returns plaintext once; member lists own keys only", async () => {
    const org = await createTestOrg("keys");
    try {
      const created = await createPOST(
        await authedRequest("/api/v1/keys", org.member, {
          method: "POST",
          body: { label: "box-1" },
        }),
      );
      expect(created.status).toBe(201);
      const { key, plaintext } = await created.json();
      expect(plaintext).toMatch(/^cursus_/);
      expect(key.label).toBe("box-1");

      // The new key authenticates ingestion (unified auth, M2.4).
      const run = await runsPOST(
        apiRequest("/api/v1/runs", {
          method: "POST",
          body: { project: "p" },
          apiKey: plaintext,
        }),
      );
      expect(run.status).toBe(201);

      // Member list: own key only, no owner column, no plaintext.
      const list = await listGET(
        await authedRequest("/api/v1/keys", org.member),
      );
      const keys = (await list.json()).keys as Record<string, unknown>[];
      expect(keys).toHaveLength(1);
      expect(keys[0]).not.toHaveProperty("ownerEmail");
      expect(JSON.stringify(keys)).not.toContain(plaintext);

      // Admin list: sees it with the owner column.
      const adminList = await listGET(
        await authedRequest("/api/v1/keys", org.admin),
      );
      const adminKeys = (await adminList.json()).keys as Record<
        string,
        unknown
      >[];
      expect(adminKeys).toHaveLength(1);
      expect(adminKeys[0]).toHaveProperty("ownerEmail", org.member.email);
    } finally {
      await org.cleanup();
    }
  });

  it("member cannot revoke another user's key; admin can", async () => {
    const org = await createTestOrg("keys");
    try {
      const adminKey = await createPOST(
        await authedRequest("/api/v1/keys", org.admin, {
          method: "POST",
          body: { label: "admin-key" },
        }),
      );
      const adminKeyId = ((await adminKey.json()).key as { id: string }).id;

      const forbidden = await revokeDELETE(
        await authedRequest(`/api/v1/keys/${adminKeyId}`, org.member, {
          method: "DELETE",
        }),
        { params: Promise.resolve({ keyId: adminKeyId }) },
      );
      expect(forbidden.status).toBe(403);

      // Admin revokes the MEMBER's key instead.
      const memberKey = await createPOST(
        await authedRequest("/api/v1/keys", org.member, {
          method: "POST",
          body: { label: "member-key" },
        }),
      );
      const memberBody = await memberKey.json();
      const ok = await revokeDELETE(
        await authedRequest(`/api/v1/keys/${memberBody.key.id}`, org.admin, {
          method: "DELETE",
        }),
        { params: Promise.resolve({ keyId: memberBody.key.id }) },
      );
      expect(ok.status).toBe(200);

      // Revoked key is dead for ingestion.
      const dead = await logPOST(
        apiRequest("/api/v1/runs/x/log", {
          method: "POST",
          body: { points: [{ key: "a", step: 0, value: 1 }] },
          apiKey: memberBody.plaintext,
        }),
        { params: Promise.resolve({ runId: "x" }) },
      );
      expect(dead.status).toBe(401);
    } finally {
      await org.cleanup();
    }
  });

  it("anonymous key management → 401; unknown key → 404", async () => {
    const org = await createTestOrg("keys");
    try {
      expect((await listGET(apiRequest("/api/v1/keys"))).status).toBe(401);
      const res = await revokeDELETE(
        await authedRequest("/api/v1/keys/nope", org.admin, {
          method: "DELETE",
        }),
        { params: Promise.resolve({ keyId: "nope" }) },
      );
      expect(res.status).toBe(404);
    } finally {
      await org.cleanup();
    }
  });
});
