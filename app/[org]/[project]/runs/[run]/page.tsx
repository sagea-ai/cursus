import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfigViewer } from "@/components/config-viewer";
import { RunCharts } from "@/components/run-charts";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requirePageSession } from "@/lib/page-auth";
import { getRun } from "@/lib/runs";

// NOTE (M3 follow-up): run rename + tag editing live here per §7.6. Display
// only in M2 — the PATCH endpoint + inline editing land with M3 polish.
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
  } catch {
    notFound();
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
          <h1 className="text-2xl font-semibold">{detail.name}</h1>
          <StatusBadge status={detail.status} />
          {detail.tags.map((t) => (
            <Badge key={t} variant="outline">
              {t}
            </Badge>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          by {detail.createdBy} · started {detail.startedAt.toLocaleString()}
        </p>
      </div>

      <Tabs defaultValue="charts">
        <TabsList>
          <TabsTrigger value="charts">Charts</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
        </TabsList>
        <TabsContent value="charts">
          <RunCharts
            runId={detail.id}
            metricKeys={detail.keys}
            live={detail.status === "RUNNING"}
          />
        </TabsContent>
        <TabsContent value="config">
          <ConfigViewer config={detail.config} />
        </TabsContent>
      </Tabs>
    </main>
  );
}
