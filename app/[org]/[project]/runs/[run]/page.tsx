import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfigViewer } from "@/components/config-viewer";
import { ExportMenu } from "@/components/export-menu";
import { MediaViewer } from "@/components/media-viewer";
import { RunCharts } from "@/components/run-charts";
import { RunHeaderEditor } from "@/components/run-header-editor";
import { RunOverview } from "@/components/run-overview";
import { StatusBadge } from "@/components/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isNotFoundError } from "@/lib/http";
import { getRunMediaView } from "@/lib/media";
import { requirePageSession } from "@/lib/page-auth";
import { storageEnabled } from "@/lib/storage";
import { getRunArtifacts } from "@/lib/artifacts";
import { getRun } from "@/lib/runs";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ org: string; project: string; run: string }>;
}) {
  const { org: orgSlug, project: projectSlug, run: runId } = await params;
  const { session, org } = await requirePageSession(orgSlug);
  let detail;
  try {
    detail = await getRun(session, runId);
  } catch (e) {
    if (isNotFoundError(e)) notFound();
    throw e;
  }
  const produced = await getRunArtifacts(session, detail.id);
  // Media viewer data rides along (presigned step URLs, 15 min). Empty for
  // runs without images — the Charts tab simply shows no media section.
  // Skipped entirely where object storage isn't configured (media is
  // unavailable there by design, and the run page must not 503 for it).
  let media: {
    key: string;
    steps: { id: string; step: number; url: string }[];
  }[] = [];
  if (storageEnabled()) {
    media = await getRunMediaView(session, detail.id);
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-8">
      <div>
        <p className="text-xs text-muted-foreground">
          <Link href={`/${org.slug}/projects`} className="hover:underline">
            {org.name}
          </Link>{" "}
          /{" "}
          <Link
            href={`/${org.slug}/${projectSlug}/runs`}
            className="hover:underline"
          >
            {projectSlug}
          </Link>{" "}
          / {detail.name}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <RunHeaderEditor
            runId={detail.id}
            initialName={detail.name}
            initialTags={detail.tags}
            isAdmin={session.role === "SUPER_ADMIN"}
            canEdit={session.role !== "VIEWER"}
            runsPath={`/${org.slug}/${projectSlug}/runs`}
          />
          <StatusBadge status={detail.status} />
          <ExportMenu runId={detail.id} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          by {detail.createdBy} · started {detail.startedAt.toLocaleString()}
        </p>
      </div>

      <Tabs defaultValue="charts">
        <TabsList>
          <TabsTrigger value="charts">Charts</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
        </TabsList>
        <TabsContent value="charts">
          <RunCharts
            runId={detail.id}
            metricKeys={detail.keys}
            live={detail.status === "RUNNING"}
          />
          {media.length > 0 && (
            <div className="mt-5 flex flex-col gap-5">
              {media.map((m) => (
                <MediaViewer key={m.key} mediaKey={m.key} steps={m.steps} />
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="overview">
          <RunOverview
            runId={detail.id}
            runPath={`${org.slug}/${projectSlug}/${detail.id}`}
            status={detail.status}
            createdBy={detail.createdBy}
            startedAt={detail.startedAt.toISOString()}
            finishedAt={
              detail.finishedAt ? detail.finishedAt.toISOString() : null
            }
            initialNotes={detail.notes}
            artifactsBasePath={`/${org.slug}/${projectSlug}/artifacts`}
            producedArtifacts={produced.map((a) => ({
              artifactName: a.artifactName,
              version: a.version,
            }))}
            group={detail.group}
            groupBasePath={`/${org.slug}/groups`}
          />
        </TabsContent>
        <TabsContent value="config">
          <ConfigViewer config={detail.config} />
        </TabsContent>
      </Tabs>
    </main>
  );
}
