import { describe, expect, it } from "vitest";

import {
  GET as listGET,
  POST as createPOST,
} from "@/app/api/v1/orgs/[orgSlug]/projects/route";
import {
  DELETE as deletePOST,
  GET as overviewGET,
  PATCH as renamePATCH,
} from "@/app/api/v1/orgs/[orgSlug]/projects/[projectSlug]/route";
import { POST as runsPOST } from "@/app/api/v1/runs/route";
import {
  apiRequest,
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
} from "../helpers";

const params = (orgSlug: string) => ({
  params: Promise.resolve({ orgSlug }),
});

const deleteParams = (orgSlug: string, projectSlug: string) => ({
  params: Promise.resolve({ orgSlug, projectSlug }),
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

  it("project delete: admin cascades, member → 403", async () => {
    const org = await createTestOrg("projdel");
    try {
      await createPOST(
        await authedRequest("/api/v1/x", org.member, {
          method: "POST",
          body: { name: "Doomed Project" },
        }),
        params(org.orgSlug),
      );

      const memberDel = await deletePOST(
        await authedRequest("/api/v1/x", org.member, { method: "DELETE" }),
        deleteParams(org.orgSlug, "doomed-project"),
      );
      expect(memberDel.status).toBe(403);

      const adminDel = await deletePOST(
        await authedRequest("/api/v1/x", org.admin, { method: "DELETE" }),
        deleteParams(org.orgSlug, "doomed-project"),
      );
      expect(adminDel.status).toBe(200);

      const list = await listGET(
        await authedRequest("/api/v1/x", org.member),
        params(org.orgSlug),
      );
      expect((await list.json()).projects).toHaveLength(0);

      const missing = await deletePOST(
        await authedRequest("/api/v1/x", org.admin, { method: "DELETE" }),
        deleteParams(org.orgSlug, "doomed-project"),
      );
      expect(missing.status).toBe(404);
    } finally {
      await org.cleanup();
    }
  });

  it("overview aggregates runs, contributors, and compute", async () => {
    const org = await createTestOrg("projov");
    try {
      await createPOST(
        await authedRequest("/api/v1/x", org.member, {
          method: "POST",
          body: { name: "Stats Project" },
        }),
        params(org.orgSlug),
      );
      // One run per user via the runs endpoint (createdBy differs).
      for (const session of [org.member, org.admin]) {
        const made = await runsPOST(
          await authedRequest("/api/v1/runs", session, {
            method: "POST",
            body: { project: "stats-project", name: `run-${session.role}` },
          }),
        );
        expect(made.status).toBe(201);
      }
      const res = await overviewGET(
        await authedRequest("/api/v1/x", org.member),
        deleteParams(org.orgSlug, "stats-project"),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        project: { slug: string };
        visibility: string;
        totalRuns: number;
        totalComputeMs: number;
        lastActiveAt: string | null;
        contributors: { email: string; runs: number }[];
        statusCounts: Record<string, number>;
      };
      expect(body.project.slug).toBe("stats-project");
      expect(body.visibility).toBe("Team");
      expect(body.totalRuns).toBe(2);
      expect(body.totalComputeMs).toBeGreaterThanOrEqual(0);
      expect(body.lastActiveAt).not.toBeNull();
      expect(body.contributors).toHaveLength(2);
      expect(body.statusCounts).toMatchObject({ RUNNING: 2 });

      // Cross-org overview → 404.
      const other = await createTestOrg("projovB");
      try {
        const cross = await overviewGET(
          await authedRequest("/api/v1/x", other.admin),
          deleteParams(org.orgSlug, "stats-project"),
        );
        expect(cross.status).toBe(404);
      } finally {
        await other.cleanup();
      }
    } finally {
      await org.cleanup();
    }
  });

  it("rename works for members; anon → 401; missing → 404", async () => {
    const org = await createTestOrg("projren");
    try {
      await createPOST(
        await authedRequest("/api/v1/x", org.member, {
          method: "POST",
          body: { name: "Old Name" },
        }),
        params(org.orgSlug),
      );
      const renamed = await renamePATCH(
        await authedRequest("/api/v1/x", org.member, {
          method: "PATCH",
          body: { name: "New Name" },
        }),
        deleteParams(org.orgSlug, "old-name"),
      );
      expect(renamed.status).toBe(200);
      expect(((await renamed.json()).project as { name: string }).name).toBe(
        "New Name",
      );
      // Slug is stable: the overview still resolves under the old slug.
      const ov = await overviewGET(
        await authedRequest("/api/v1/x", org.member),
        deleteParams(org.orgSlug, "old-name"),
      );
      expect(((await ov.json()).project as { name: string }).name).toBe(
        "New Name",
      );

      const anon = await renamePATCH(
        apiRequest("/api/v1/x", {
          method: "PATCH",
          body: { name: "X" },
        }),
        deleteParams(org.orgSlug, "old-name"),
      );
      expect(anon.status).toBe(401);

      const missing = await renamePATCH(
        await authedRequest("/api/v1/x", org.admin, {
          method: "PATCH",
          body: { name: "X" },
        }),
        deleteParams(org.orgSlug, "nope"),
      );
      expect(missing.status).toBe(404);
    } finally {
      await org.cleanup();
    }
  });
});
