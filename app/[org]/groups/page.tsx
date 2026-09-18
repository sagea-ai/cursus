import Link from "next/link";
import { FiLayers } from "react-icons/fi";

import { NewGroupDialog } from "@/components/new-group-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requirePageSession } from "@/lib/page-auth";
import { listGroups } from "@/lib/groups";

export default async function GroupsPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org: orgSlug } = await params;
  const { session, org } = await requirePageSession(orgSlug);
  const groups = await listGroups(session);
  const isAdmin = session.role === "SUPER_ADMIN";

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{org.name}</p>
          <h1 className="text-2xl font-semibold">
            Groups{" "}
            <span className="text-base font-normal text-muted-foreground">
              {groups.length}
            </span>
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Runs logged to a group are visible only to its members. Everything
            else stays org-wide.
          </p>
        </div>
        {isAdmin && <NewGroupDialog />}
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {isAdmin ? "No groups yet" : "You are in no groups yet"}
            </CardTitle>
            <CardDescription>
              {isAdmin
                ? "Create one for a team, project phase, or customer — then invite members to it."
                : "A super admin can create groups and add you. Org-wide runs stay visible to everyone."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-muted p-4 font-mono text-xs leading-relaxed">
              {`import sagea_cursus as cursus

run = cursus.init(project="demo", group="vision-team")
cursus.log({"train/loss": 0.4}, step=1)
cursus.finish()`}
            </pre>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {groups.map((g) => (
            <Link key={g.id} href={`/${org.slug}/groups/${g.slug}`}>
              <Card className="transition-colors hover:border-primary/60">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FiLayers className="size-4 text-accent-soft" />
                    {g.name}
                  </CardTitle>
                  <CardDescription>
                    {g.memberCount} member{g.memberCount === 1 ? "" : "s"} ·{" "}
                    {g.runCount} run{g.runCount === 1 ? "" : "s"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary">/{g.slug}</Badge>
                  {g.description && (
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {g.description}
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
