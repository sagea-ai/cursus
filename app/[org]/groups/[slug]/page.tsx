import Link from "next/link";
import { notFound } from "next/navigation";
import { FiFolder } from "react-icons/fi";

import { GroupMembers } from "@/components/group-members";
import { CodeBlock } from "@/components/code-block";
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
import { getGroup, listGroupProjects } from "@/lib/groups";

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ org: string; slug: string }>;
}) {
  const { org: orgSlug, slug } = await params;
  const { session, org } = await requirePageSession(orgSlug);
  let group;
  let projects;
  try {
    group = await getGroup(session, slug);
    projects = await listGroupProjects(session, slug);
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
              Only these members (and super admins) see this group&apos;s
              projects and runs.
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
            <CardDescription>
              Pass the group slug at init time; the project is created inside
              this group.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock
              language="python"
              code={`run = cursus.init(project="demo", group="${group.slug}")`}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Projects ({projects.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {projects.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              No projects in this group yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Runs</TableHead>
                  <TableHead>Last active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link
                        href={`/${org.slug}/${p.slug}/runs`}
                        className="flex items-center gap-2 font-medium text-accent-pale hover:underline"
                      >
                        <FiFolder className="size-4 shrink-0" />
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.runCount}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {p.lastActiveAt
                        ? p.lastActiveAt.toLocaleDateString()
                        : "—"}
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
