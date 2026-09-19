import { NewProjectDialog } from "@/components/new-project-dialog";
import { ProjectsTable } from "@/components/projects-table";
import { CodeBlock } from "@/components/code-block";
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
          <h1 className="text-2xl font-semibold">Projects </h1>
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
            <CodeBlock
              language="python"
              code={`import sagea_cursus as cursus

run = cursus.init(project="my-first-project")
cursus.log({"train/loss": 0.4}, step=1)
cursus.finish()`}
            />
          </CardContent>
        </Card>
      ) : (
        <ProjectsTable
          projects={projects}
          orgSlug={org.slug}
          isAdmin={session.role === "SUPER_ADMIN"}
        />
      )}
    </main>
  );
}
