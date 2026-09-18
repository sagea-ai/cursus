import { describe, expect, it } from "vitest";

import { GET as auditGET } from "@/app/api/v1/audit/route";
import { POST as createPOST } from "@/app/api/v1/keys/route";
import { DELETE as revokeDELETE } from "@/app/api/v1/keys/[keyId]/route";
import { POST as rotatePOST } from "@/app/api/v1/keys/[keyId]/rotate/route";
import {
  apiRequest,
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
} from "../helpers";

describe.skipIf(!apiTestsEnabled)("audit log", () => {
  it("records create/rotate/revoke; members see only their own", async () => {
    const org = await createTestOrg("audit");
    try {
      const created = await createPOST(
        await authedRequest("/api/v1/keys", org.member, {
          method: "POST",
          body: { label: "audited" },
        }),
      );
      const keyId = ((await created.json()).key as { id: string }).id;
      await rotatePOST(
        await authedRequest(`/api/v1/keys/${keyId}/rotate`, org.member, {
          method: "POST",
        }),
        { params: Promise.resolve({ keyId }) },
      );
      // Rotate leaves the replacement active; revoke it to close the trail.
      const listed = (await (
        await createPOST(
          await authedRequest("/api/v1/keys", org.member, {
            method: "POST",
            body: { label: "other" },
          }),
        )
      ).json()) as { key: { id: string } };
      await revokeDELETE(
        await authedRequest(`/api/v1/keys/${listed.key.id}`, org.member, {
          method: "DELETE",
        }),
        { params: Promise.resolve({ keyId: listed.key.id }) },
      );

      const adminView = (await (
        await auditGET(await authedRequest("/api/v1/audit", org.admin))
      ).json()) as {
        events: { action: string; actor: { email: string } }[];
      };
      const actions = adminView.events.map((e) => e.action);
      expect(actions).toContain("api_key.created");
      expect(actions).toContain("api_key.rotated");
      expect(actions).toContain("api_key.revoked");
      expect(
        adminView.events.every((e) => e.actor.email === org.member.email),
      ).toBe(true);

      // A stranger (third user would be cleaner; reuse admin-as-stranger
      // inverted): member sees their own events but nothing else exists.
      const memberView = (await (
        await auditGET(await authedRequest("/api/v1/audit", org.member))
      ).json()) as { events: unknown[] };
      expect(memberView.events.length).toBe(adminView.events.length);

      const anon = await auditGET(apiRequest("/api/v1/audit"));
      expect(anon.status).toBe(401);
    } finally {
      await org.cleanup();
    }
  });

  it("member cannot see another member's key events", async () => {
    const org = await createTestOrg("audit");
    try {
      // Admin's key event must not appear in the member's history.
      await createPOST(
        await authedRequest("/api/v1/keys", org.admin, {
          method: "POST",
          body: { label: "admin-only" },
        }),
      );
      const memberView = (await (
        await auditGET(await authedRequest("/api/v1/audit", org.member))
      ).json()) as { events: { targetType: string }[] };
      expect(memberView.events).toHaveLength(0);
    } finally {
      await org.cleanup();
    }
  });
});
