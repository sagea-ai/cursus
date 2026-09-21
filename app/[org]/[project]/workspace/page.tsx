import Link from "next/link";
import { notFound } from "next/navigation";

import { ProjectTabs } from "@/components/project-tabs";
import { WorkspaceView } from "@/components/workspace-view";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isNotFoundError } from "@/lib/http";
import { requirePageSession } from "@/lib/page-auth";
import { getProjectOverview } from "@/lib/projects";
import { listRuns } from "@/lib/runs";

// Project workspace: pick runs on the left, overlay their metrics per key
// on the right (W&B-style). Metric keys come from the runs' summaries
// (one list query, no Metric join); series load per section, batched.
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ org: string; project: string }>;
}) {
  const { org: orgSlug, project: projectSlug } = await params;
  const { session, org } = await requirePageSession(orgSlug);
  let ov;
  try {
    ov = await getProjectOverview(session, orgSlug, projectSlug);
  } catch (e) {
    if (isNotFoundError(e)) notFound();
    throw e;
  }
  const { runs } = await listRuns(session, ov.project.slug, {
    limit: 200,
    sort: "recent",
  });

  const keySet = new Set<string>();
  for (const r of runs) {
    const summary = (r.summary ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(summary)) {
      if (keySet.size >= 30) break;
      keySet.add(k);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-8">
      <div>
        <p className="text-xs text-muted-foreground">
          {org.name} / {ov.project.slug}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overlay up to 10 runs per chart, each in its own color.{" "}
          <Link
            href={`/${org.slug}/${ov.project.slug}/runs`}
            className="text-accent-pale hover:underline"
          >
            Manage runs
          </Link>
        </p>
      </div>
      <ProjectTabs orgSlug={org.slug} projectSlug={ov.project.slug} />

      {runs.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No runs yet</CardTitle>
            <CardDescription>
              Log a run first — overlays appear once two runs share a metric
              key.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <WorkspaceView
          runs={runs.map((r) => ({ id: r.id, name: r.name, status: r.status }))}
          metricKeys={[...keySet].sort()}
          projectSlug={ov.project.slug}
        />
      )}
    </main>
  );
}
