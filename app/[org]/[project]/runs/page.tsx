import { notFound } from "next/navigation";

import { RunsTable, type RunRow } from "@/components/runs-table";
import { requirePageSession } from "@/lib/page-auth";
import { listRuns } from "@/lib/runs";

export default async function RunsPage({
  params,
}: {
  params: Promise<{ org: string; project: string }>;
}) {
  const { org: orgSlug, project: projectSlug } = await params;
  const { session, org } = await requirePageSession(orgSlug);
  let data;
  try {
    data = await listRuns(session, projectSlug, { limit: 200 });
  } catch {
    notFound();
  }

  const rows: RunRow[] = data.runs.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    tags: r.tags,
    summary: (r.summary ?? {}) as Record<string, number>,
    createdBy: r.createdBy,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  }));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-8">
      <div>
        <p className="text-xs text-muted-foreground">
          {org.name} / {projectSlug}
        </p>
        <h1 className="text-2xl font-semibold">{projectSlug}</h1>
      </div>
      <RunsTable runs={rows} basePath={`/${org.slug}/${projectSlug}/runs`} />
    </main>
  );
}
