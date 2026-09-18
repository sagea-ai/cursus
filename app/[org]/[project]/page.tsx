import { notFound } from "next/navigation";

import { KeysManager, type KeyRow } from "@/components/keys-manager";
import { ProjectGroupMove } from "@/components/project-group-move";
import { ProjectRename } from "@/components/project-rename";
import { ProjectTabs } from "@/components/project-tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isNotFoundError } from "@/lib/http";
import { listKeys } from "@/lib/keys";
import { requirePageSession } from "@/lib/page-auth";
import { getProjectOverview } from "@/lib/projects";

function formatCompute(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function formatDate(d: Date | null): string {
  return d ? d.toLocaleString() : "—";
}

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ org: string; project: string }>;
}) {
  const { org: orgSlug, project: projectSlug } = await params;
  const { session, org } = await requirePageSession(orgSlug);
  let ov;
  try {
    ov = await getProjectOverview(session, org.slug, projectSlug);
  } catch (e) {
    if (isNotFoundError(e)) notFound();
    throw e;
  }
  const keys = await listKeys(session);
  const keyRows: KeyRow[] = keys.map((k) => ({
    id: k.id,
    label: k.label,
    ownerEmail: k.ownerEmail,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
  }));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-8">
      <div>
        <p className="text-xs text-muted-foreground">
          {org.name} / {ov.project.slug}
        </p>
        <ProjectRename
          orgSlug={org.slug}
          projectSlug={ov.project.slug}
          initialName={ov.project.name}
        />
      </div>
      <ProjectTabs orgSlug={org.slug} projectSlug={ov.project.slug} />

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="api-keys">API keys</TabsTrigger>
        </TabsList>
        <TabsContent value="details">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-2.5 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Visibility</dt>
                    <dd>
                      {ov.project.group
                        ? `Group “${ov.project.group.name}” (members only)`
                        : `Org-wide — everyone in ${org.name} sees everything`}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Group</dt>
                    <dd>
                      {session.role === "SUPER_ADMIN" ? (
                        <ProjectGroupMove
                          orgSlug={org.slug}
                          projectSlug={ov.project.slug}
                          current={ov.project.group}
                        />
                      ) : (
                        (ov.project.group?.name ?? "Org-wide")
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Last active</dt>
                    <dd>{formatDate(ov.lastActiveAt)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Contributors</dt>
                    <dd>
                      {ov.contributors.length === 0
                        ? "—"
                        : ov.contributors
                            .map((c) => `${c.name || c.email} (${c.runs})`)
                            .join(", ")}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Total runs</dt>
                    <dd>{ov.totalRuns}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Total compute</dt>
                    <dd>{formatCompute(ov.totalComputeMs)}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Export & update data
                </CardTitle>
                <CardDescription>
                  The same API the SDK uses — script anything the dashboard
                  doesn&apos;t show.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm">
                <div>
                  <p className="font-medium">Find the run path</p>
                  <p className="mt-0.5 text-muted-foreground">
                    Runs are addressed as{" "}
                    <code className="rounded bg-muted px-1 font-mono text-xs">
                      {"<org>/<project>/<run_id>"}
                    </code>{" "}
                    — copy the id from any run page URL.
                  </p>
                </div>
                <div>
                  <p className="font-medium">Export metrics to CSV</p>
                  <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
                    {`curl -H "Authorization: Bearer $CURSUS_API_KEY" \\
  "${"${CURSUS_BASE_URL}"}/api/v1/runs/<run_id>/export?format=csv" \\
  -o metrics.csv`}
                  </pre>
                </div>
                <div>
                  <p className="font-medium">
                    Rename, retag, or annotate a run
                  </p>
                  <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
                    {`curl -X PATCH -H "Authorization: Bearer $CURSUS_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -d '{"notes": "promising direction"}' \\
  "${"${CURSUS_BASE_URL}"}/api/v1/runs/<run_id>"`}
                  </pre>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="api-keys">
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Keys are org-scoped: the same keys below work from any project.
              Generate one, rotate (reshuffle) it when it leaks, or revoke it.
            </p>
            <KeysManager
              keys={keyRows}
              isAdmin={session.role === "SUPER_ADMIN"}
              orgSlug={org.slug}
            />
          </div>
        </TabsContent>
      </Tabs>
    </main>
  );
}
