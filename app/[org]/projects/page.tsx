import Link from "next/link";
import { FiBox } from "react-icons/fi";

import { NewProjectDialog } from "@/components/new-project-dialog";
import { DeleteProjectButton } from "@/components/delete-project-button";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listProjects } from "@/lib/projects";
import { requirePageSession } from "@/lib/page-auth";

function timeAgo(d: Date | null): string {
  if (!d) return "never";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org: orgSlug } = await params;
  const { session, org } = await requirePageSession(orgSlug);
  const projects = await listProjects(session, org.slug);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{org.name}</p>
          <h1 className="text-2xl font-semibold">Projects</h1>
        </div>
        <NewProjectDialog orgSlug={org.slug} />
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No projects yet</CardTitle>
            <CardDescription>
              The fastest path to a first project is logging a run — the project
              is created automatically on first{" "}
              <code className="font-mono text-accent-pale">init()</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-muted p-4 font-mono text-xs leading-relaxed">
              {`import sagea_cursus as cursus

run = cursus.init(project="my-first-project")
cursus.log({"train/loss": 0.4}, step=1)
cursus.finish()`}
            </pre>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <Card
              key={p.id}
              className="transition-colors hover:border-primary/60"
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FiBox className="size-4 shrink-0 text-accent-soft" />
                  <Link
                    href={`/${org.slug}/${p.slug}/runs`}
                    className="min-w-0 flex-1 truncate hover:underline"
                  >
                    {p.name}
                  </Link>
                  {session.role === "SUPER_ADMIN" && (
                    <DeleteProjectButton
                      orgSlug={org.slug}
                      projectSlug={p.slug}
                      projectName={p.name}
                    />
                  )}
                </CardTitle>
                <CardDescription>
                  {p.runCount} run{p.runCount === 1 ? "" : "s"} · active{" "}
                  {timeAgo(p.lastRunAt)}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {Object.entries(p.statusCounts).map(([status, n]) => (
                  <span key={status} className="flex items-center gap-1.5">
                    <StatusBadge status={status} />
                    <Badge variant="outline">{n}</Badge>
                  </span>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
