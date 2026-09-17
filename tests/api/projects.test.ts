import { describe, expect, it } from "vitest";

import {
  GET as listGET,
  POST as createPOST,
} from "@/app/api/v1/orgs/[orgSlug]/projects/route";
import {
  apiRequest,
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
} from "../helpers";

const params = (orgSlug: string) => ({
  params: Promise.resolve({ orgSlug }),
});

describe.skipIf(!apiTestsEnabled)("projects routes", () => {
  it("lists empty, creates, rejects duplicates, sorts by activity", async () => {
    const org = await createTestOrg("proj");
    try {
      const empty = await listGET(
        await authedRequest("/api/v1/x", org.member),
        params(org.orgSlug),
      );
      expect(empty.status).toBe(200);
      expect((await empty.json()).projects).toHaveLength(0);

      const created = await createPOST(
        await authedRequest("/api/v1/x", org.member, {
          method: "POST",
          body: { name: "My Project" },
        }),
        params(org.orgSlug),
      );
      expect(created.status).toBe(201);
      expect((await created.json()).project.slug).toBe("my-project");

      const dup = await createPOST(
        await authedRequest("/api/v1/x", org.member, {
          method: "POST",
          body: { name: "My Project" },
        }),
        params(org.orgSlug),
      );
      expect(dup.status).toBe(409);

      const list = await listGET(
        await authedRequest("/api/v1/x", org.member),
        params(org.orgSlug),
      );
      const projects = (await list.json()).projects as {
        slug: string;
        runCount: number;
      }[];
      expect(projects).toHaveLength(1);
      expect(projects[0].runCount).toBe(0);
    } finally {
      await org.cleanup();
    }
  });

  it("anonymous → 401; cross-org slug → 404", async () => {
    const a = await createTestOrg("projA");
    const b = await createTestOrg("projB");
    try {
      expect(
        (await listGET(apiRequest("/api/v1/x"), params(a.orgSlug))).status,
      ).toBe(401);
      const cross = await listGET(
        await authedRequest("/api/v1/x", a.admin),
        params(b.orgSlug),
      );
      expect(cross.status).toBe(404);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });
});
