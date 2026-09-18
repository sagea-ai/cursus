import Link from "next/link";
import { notFound } from "next/navigation";
import { FiDownload } from "react-icons/fi";

import { ProjectTabs } from "@/components/project-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isNotFoundError } from "@/lib/http";
import { requirePageSession } from "@/lib/page-auth";
import { getArtifactDetail } from "@/lib/artifacts";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default async function ArtifactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; project: string; name: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { org: orgSlug, project: projectSlug, name: rawName } = await params;
  const { v: vRaw } = await searchParams;
  const name = decodeURIComponent(rawName);
  const version =
    !vRaw || vRaw === "latest"
      ? ("latest" as const)
      : Number.parseInt(vRaw, 10);
  if (version !== "latest" && !Number.isInteger(version)) notFound();
  const { session, org } = await requirePageSession(orgSlug);
  let detail;
  try {
    detail = await getArtifactDetail(session, projectSlug, name, version);
  } catch (e) {
    if (isNotFoundError(e)) notFound();
    throw e;
  }
  const basePath = `/${org.slug}/${projectSlug}/artifacts/${encodeURIComponent(detail.name)}`;
  const selectedMeta = detail.versions.find(
    (v) => v.version === detail.selected.version,
  )!;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-8">
      <div>
        <p className="text-xs text-muted-foreground">
          {org.name} / {projectSlug} / artifacts
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{detail.name}</h1>
          <Badge variant="secondary">{detail.type}</Badge>
        </div>
      </div>
      <ProjectTabs orgSlug={org.slug} projectSlug={projectSlug} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Version:</span>
        {detail.versions.map((v) => (
          <Link
            key={v.version}
            href={`${basePath}?v=${v.version}`}
            aria-current={
              v.version === detail.selected.version ? "page" : undefined
            }
          >
            <Button
              variant={
                v.version === detail.selected.version ? "default" : "ghost"
              }
              size="sm"
            >
              v{v.version}
            </Button>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Version overview</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Full name</dt>
                <dd className="truncate font-mono text-xs">
                  {org.slug}/{projectSlug}/{detail.name}:v
                  {detail.selected.version}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Digest</dt>
                <dd className="truncate font-mono text-xs">
                  {selectedMeta.digest}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Created by</dt>
                <dd>
                  {selectedMeta.createdByRunId ? (
                    <Link
                      href={`/${org.slug}/${projectSlug}/runs/${selectedMeta.createdByRunId}`}
                      className="text-accent-pale hover:underline"
                    >
                      {selectedMeta.createdByRunName ??
                        selectedMeta.createdByRunId}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Description</dt>
                <dd>{selectedMeta.description || "—"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Files ({detail.selected.files.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Path</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.selected.files.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-mono text-xs">
                      {f.path}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatBytes(f.sizeBytes)}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" asChild>
                        <a
                          href={`/api/v1/artifact-files/${f.id}`}
                          download
                          aria-label={`Download ${f.path}`}
                        >
                          <FiDownload />
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
