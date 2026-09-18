import Link from "next/link";
import { notFound } from "next/navigation";

import { GroupMembers } from "@/components/group-members";
import { StatusBadge } from "@/components/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { getGroup, listGroupRuns } from "@/lib/groups";

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ org: string; slug: string }>;
}) {
  const { org: orgSlug, slug } = await params;
  const { session, org } = await requirePageSession(orgSlug);
  let group;
  let runs;
  try {
    group = await getGroup(session, slug);
    runs = await listGroupRuns(session, slug);
  } catch (e) {
    if (isNotFoundError(e)) notFound();
    throw e;
  }
  const isAdmin = session.role === "SUPER_ADMIN";

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-8">
      <div>
        <p className="text-xs text-muted-foreground">
          {org.name} / groups / {group.slug}
        </p>
        <h1 className="text-2xl font-semibold">{group.name}</h1>
        {group.description && (
          <p className="mt-1 text-sm text-muted-foreground">
            {group.description}
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Members ({group.memberCount})
            </CardTitle>
            <CardDescription>
              Only these members (and super admins) see this group&apos;s runs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GroupMembers
              groupSlug={group.slug}
              members={group.members}
              isAdmin={isAdmin}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Log runs here</CardTitle>
            <CardDescription>Pass the group slug at init time.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-muted p-4 font-mono text-xs leading-relaxed">
              {`run = cursus.init(project="demo", group="${group.slug}")`}
            </pre>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Runs ({runs.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {runs.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              No runs in this group yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/${org.slug}/${r.projectSlug}/runs/${r.id}`}
                        className="font-medium text-accent-pale hover:underline"
                      >
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.projectSlug}
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-xs text-muted-foreground">
                      {r.createdBy}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {r.startedAt.toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
