import Link from "next/link";

import { ProjectTabs } from "@/components/project-tabs";
import { SweepCreateDialog } from "@/components/sweep-create-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requirePageSession } from "@/lib/page-auth";
import { getProjectOverview } from "@/lib/projects";
import { listSweeps } from "@/lib/sweeps";
import { isNotFoundError } from "@/lib/http";
import { notFound } from "next/navigation";

const STATE_VARIANT = {
  RUNNING: "active",
  FINISHED: "secondary",
  CANCELLED: "revoke",
} as const;

export default async function SweepsPage({
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
  const sweeps = await listSweeps(session, ov.project.slug);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-8">
      <div>
        <p className="text-xs text-muted-foreground">
          {org.name} / {ov.project.slug}
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Sweeps</h1>
          {session.role !== "VIEWER" && (
            <SweepCreateDialog projectSlug={ov.project.slug} />
          )}
        </div>
      </div>
      <ProjectTabs orgSlug={org.slug} projectSlug={ov.project.slug} />

      {sweeps.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No sweeps yet</CardTitle>
            <CardDescription>
              Grid or random search over a declared space — workers pull trials
              with <code className="font-mono">cursus.next_trial</code>.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sweeps.map((s) => (
            <Link
              key={s.id}
              href={`/${org.slug}/${ov.project.slug}/sweeps/${s.id}`}
            >
              <Card className="transition-colors hover:bg-muted/40">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">{s.name}</CardTitle>
                    <Badge
                      variant={
                        STATE_VARIANT[s.state as keyof typeof STATE_VARIANT]
                      }
                    >
                      {s.state}
                    </Badge>
                  </div>
                  <CardDescription>
                    {s.method} · {s.runCount}{" "}
                    {s.runCount === 1 ? "run" : "runs"} · by {s.createdBy}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
