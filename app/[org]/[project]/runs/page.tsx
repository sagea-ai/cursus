import { notFound } from "next/navigation";

import { ProjectTabs } from "@/components/project-tabs";
import { RunsTable, type RunRow } from "@/components/runs-table";
import { isNotFoundError } from "@/lib/http";
import { requirePageSession } from "@/lib/page-auth";
import { listRuns } from "@/lib/runs";
import type { RunListSort } from "@/lib/validation";

const SORTS: RunListSort[] = ["recent", "oldest", "name_asc", "name_desc"];

export default async function RunsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ sort?: string }>;
}) {
  const { org: orgSlug, project: projectSlug } = await params;
  const { sort: sortRaw } = await searchParams;
  const sort: RunListSort = (SORTS as string[]).includes(sortRaw ?? "")
    ? (sortRaw as RunListSort)
    : "recent";
  const { session, org } = await requirePageSession(orgSlug);
  let data;
  try {
    data = await listRuns(session, projectSlug, { limit: 200, sort });
  } catch (e) {
    if (isNotFoundError(e)) notFound();
    throw e;
  }

  const rows: RunRow[] = data.runs.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    tags: r.tags,
    notes: r.notes,
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
      <ProjectTabs orgSlug={org.slug} projectSlug={projectSlug} />
      <RunsTable
        runs={rows}
        sort={sort}
        basePath={`/${org.slug}/${projectSlug}/runs`}
      />
    </main>
  );
}
