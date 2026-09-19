import Link from "next/link";
import { notFound } from "next/navigation";

import { ProjectTabs } from "@/components/project-tabs";
import { SweepDetail } from "@/components/sweep-detail";
import { isNotFoundError } from "@/lib/http";
import { requirePageSession } from "@/lib/page-auth";
import { getProjectOverview } from "@/lib/projects";
import { getSweep, listSweepRuns } from "@/lib/sweeps";

export default async function SweepDetailPage({
  params,
}: {
  params: Promise<{ org: string; project: string; id: string }>;
}) {
  const { org: orgSlug, project: projectSlug, id } = await params;
  const { session, org } = await requirePageSession(orgSlug);
  let ov;
  try {
    ov = await getProjectOverview(session, orgSlug, projectSlug);
  } catch (e) {
    if (isNotFoundError(e)) notFound();
    throw e;
  }
  let sweep;
  try {
    sweep = await getSweep(session, id);
  } catch (e) {
    if (isNotFoundError(e)) notFound();
    throw e;
  }
  const runs = await listSweepRuns(session, id);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-8">
      <div>
        <p className="text-xs text-muted-foreground">
          {org.name} /{" "}
          <Link
            href={`/${org.slug}/${ov.project.slug}/sweeps`}
            className="hover:underline"
          >
            sweeps
          </Link>{" "}
          / {sweep.name}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{sweep.name}</h1>
      </div>
      <ProjectTabs orgSlug={org.slug} projectSlug={ov.project.slug} />
      <SweepDetail
        sweep={sweep}
        canWrite={session.role !== "VIEWER"}
        runs={runs.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          startedAt: r.startedAt.toISOString(),
          runHref: `/${org.slug}/${ov.project.slug}/runs/${r.id}`,
        }))}
      />
    </main>
  );
}
