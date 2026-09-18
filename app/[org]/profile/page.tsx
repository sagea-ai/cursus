import Link from "next/link";

import { ActivityHeatmap } from "@/components/activity-heatmap";
import { EditProfileDialog } from "@/components/edit-profile-dialog";
import { StatusBadge } from "@/components/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePageSession } from "@/lib/page-auth";
import { getActivity, getProfile, listProfileRuns } from "@/lib/profile";
import { listGroups } from "@/lib/groups";

function timeAgo(d: Date): string {
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const days = Math.floor(s / 86400);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { org: orgSlug } = await params;
  const { q } = await searchParams;
  const { session, org } = await requirePageSession(orgSlug);
  const [user, activity, runs, groups] = await Promise.all([
    getProfile(session),
    getActivity(session),
    listProfileRuns(session, { q, limit: 50 }),
    listGroups(session),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-6xl gap-8 p-8">
      <aside className="flex w-64 shrink-0 flex-col gap-4">
        <span
          aria-hidden
          className="flex size-24 items-center justify-center rounded-full bg-primary/15 text-3xl font-bold text-primary-ink"
        >
          {(user.name || user.email).charAt(0).toUpperCase()}
        </span>
        <div>
          <h1 className="text-2xl font-semibold">{user.name || user.email}</h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
        {user.bio && <p className="text-sm">{user.bio}</p>}
        <EditProfileDialog user={user} />
        <dl className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          <div className="font-medium text-foreground">{org.name}</div>
          {user.location && <div>{user.location}</div>}
          {user.website && (
            <div>
              <a
                href={user.website}
                target="_blank"
                rel="noreferrer"
                className="text-accent-pale hover:underline"
              >
                {user.website.replace(/^https?:\/\//, "")}
              </a>
            </div>
          )}
          {user.twitter && <div>@{user.twitter}</div>}
          {user.github && <div>{user.github}</div>}
        </dl>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold">Teams</h2>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Org-wide only.</p>
          ) : (
            groups.map((g) => (
              <Link
                key={g.id}
                href={`/${org.slug}/groups/${g.slug}`}
                className="text-sm text-accent-pale hover:underline"
              >
                {g.name}
              </Link>
            ))
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Activity{" "}
              <span className="font-normal text-muted-foreground">
                · {activity.total} run{activity.total === 1 ? "" : "s"} in the
                last year
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityHeatmap days={activity.days} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent runs</CardTitle>
            <CardDescription>
              Runs you created that are still visible to you.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <form method="get">
              <Input
                name="q"
                defaultValue={q ?? ""}
                placeholder="Search run name"
                aria-label="Search your runs"
                className="max-w-sm"
              />
            </form>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        href={`/${org.slug}/${r.projectSlug}/runs/${r.id}`}
                        className="font-medium text-accent-pale hover:underline"
                      >
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.projectName}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {timeAgo(r.startedAt)}
                    </TableCell>
                  </TableRow>
                ))}
                {runs.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No runs yet — log your first one from a training script.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
