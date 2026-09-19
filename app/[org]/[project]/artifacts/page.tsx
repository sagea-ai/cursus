import Link from "next/link";
import { notFound } from "next/navigation";
import { FiBox } from "react-icons/fi";

import { ProjectTabs } from "@/components/project-tabs";
import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isNotFoundError } from "@/lib/http";
import { requirePageSession } from "@/lib/page-auth";
import { listArtifacts } from "@/lib/artifacts";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default async function ArtifactsPage({
  params,
}: {
  params: Promise<{ org: string; project: string }>;
}) {
  const { org: orgSlug, project: projectSlug } = await params;
  const { session, org } = await requirePageSession(orgSlug);
  let artifacts;
  try {
    artifacts = await listArtifacts(session, projectSlug);
  } catch (e) {
    if (isNotFoundError(e)) notFound();
    throw e;
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-8">
      <div>
        <p className="text-xs text-muted-foreground">
          {org.name} / {projectSlug}
        </p>
        <h1 className="text-2xl font-semibold">{projectSlug}</h1>
      </div>
      <ProjectTabs orgSlug={org.slug} projectSlug={projectSlug} />

      {artifacts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No artifacts yet</CardTitle>
            <CardDescription>
              Log one from a training script — versions appear here
              automatically.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock
              language="python"
              code={`import sagea_cursus as cursus

cursus.log_artifact("my-model", "runs/train/weights/best.pt",
                    type="model", description="map50: 0.61")`}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {artifacts.map((a) => (
            <Link
              key={a.id}
              href={`/${org.slug}/${projectSlug}/artifacts/${encodeURIComponent(a.name)}`}
            >
              <Card className="transition-colors hover:border-primary/60">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FiBox className="size-4 text-accent-soft" />
                    {a.name}
                  </CardTitle>
                  <CardDescription>
                    {a.type} · v{a.latest?.version ?? "—"} · {a.versionCount}{" "}
                    version{a.versionCount === 1 ? "" : "s"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-1.5">
                  {a.latest && (
                    <>
                      <Badge variant="secondary">
                        {formatBytes(a.latest.sizeBytes)}
                      </Badge>
                      <Badge variant="outline">
                        {a.latest.fileCount} file
                        {a.latest.fileCount === 1 ? "" : "s"}
                      </Badge>
                    </>
                  )}
                  {a.description && (
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {a.description}
                    </span>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
