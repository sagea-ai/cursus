import { GroupsTable } from "@/components/groups-table";
import { NewGroupDialog } from "@/components/new-group-dialog";
import { CodeBlock } from "@/components/code-block";
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
            <CodeBlock
              language="python"
              code={`import sagea_cursus as cursus

run = cursus.init(project="demo", group="vision-team")
cursus.log({"train/loss": 0.4}, step=1)
cursus.finish()`}
            />
          </CardContent>
        </Card>
      ) : (
        <GroupsTable
          groups={groups}
          orgSlug={org.slug}
          isAdmin={session.role === "SUPER_ADMIN"}
        />
      )}
    </main>
  );
}
