import { NewProjectDialog } from "@/components/new-project-dialog";
import { ProjectGrid } from "@/components/project-grid";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listProjects } from "@/lib/projects";
import { requirePageSession } from "@/lib/page-auth";

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
          <h1 className="text-2xl font-semibold">
            Projects{" "}
            <span className="text-base font-normal text-muted-foreground">
              {projects.length}
            </span>
          </h1>
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
        <ProjectGrid
          projects={projects}
          orgSlug={org.slug}
          isAdmin={session.role === "SUPER_ADMIN"}
        />
      )}
    </main>
  );
}
