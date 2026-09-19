import Link from "next/link";

import { ActivityChart } from "@/components/activity-chart";
import { StatusMixChart } from "@/components/status-mix-chart";
import { TopProjectsChart } from "@/components/top-projects-chart";
import { CodeBlock } from "@/components/code-block";
import { DashboardGreeting } from "@/components/dashboard-greeting";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requirePageSession } from "@/lib/page-auth";
import { getDashboardStats } from "@/lib/dashboard";
import { listGroups } from "@/lib/groups";

function formatCompute(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org: orgSlug } = await params;
  const { session, org, displayName } = await requirePageSession(orgSlug);
  const isAdmin = session.role === "SUPER_ADMIN";
  const [stats, groups] = await Promise.all([
    getDashboardStats(session),
    isAdmin ? Promise.resolve([]) : listGroups(session),
  ]);

  // Subtexts reuse already-fetched data only — no extra queries.
  const weekCount = stats.activity
    .slice(-7)
    .reduce((sum, day) => sum + day.count, 0);
  const runningNames = stats.recentRuns
    .filter((r) => r.status === "RUNNING")
    .slice(0, 3)
    .map((r) => r.name);

  const cards = [
    {
      label: "Runs",
      value: String(stats.totalRuns),
      sub: `+${weekCount} this week`,
    },
    {
      label: "Running now",
      value: String(stats.runningNow),
      sub: runningNames.length > 0 ? runningNames.join(", ") : "idle",
    },
    {
      label: "Projects",
      value: String(stats.projectCount),
      sub:
        stats.topProjects.length > 0
          ? `top: ${stats.topProjects[0].name}`
          : "none yet",
    },
    {
      label: isAdmin ? "Groups" : "My groups",
      value: String(stats.groupCount),
      sub: isAdmin ? `${stats.memberCount} members` : "across your teams",
    },
    {
      label: "Compute",
      value: formatCompute(stats.totalComputeMs),
      sub: `across ${stats.totalRuns} runs`,
    },
  ];
  const isEmpty = stats.totalRuns === 0;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <DashboardGreeting name={displayName} />
        <div className="flex gap-2">
          <Link href={`/${org.slug}/projects`}>
            <Button>New Project</Button>
          </Link>
          {isAdmin && (
            <Link href={`/${org.slug}/team`}>
              <Button variant="secondary">Invite member</Button>
            </Link>
          )}
        </div>
      </div>

      {isEmpty && (
        <Card>
          <CardHeader>
            <CardTitle>Set up your first run</CardTitle>
            <CardDescription>
              Log from a training script and it appears here, live.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <CodeBlock
              language="python"
              code={`import sagea_cursus as cursus

run = cursus.init(project="demo")
cursus.log({"train/loss": 0.4}, step=1)
cursus.finish()`}
            />
            <span className="flex flex-wrap gap-2 text-sm">
              <Link
                href={`/${org.slug}/settings/keys`}
                className="text-accent-pale hover:underline"
              >
                Create an API key
              </Link>
              {isAdmin && (
                <Link
                  href={`/${org.slug}/team`}
                  className="text-accent-pale hover:underline"
                >
                  Invite a teammate
                </Link>
              )}
            </span>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <p className="text-2xl font-semibold">{c.value}</p>
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
                {c.sub}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Activity</CardTitle>
            <CardDescription>
              Runs started per day, last 30 days
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActivityChart data={stats.activity} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status mix</CardTitle>
            <CardDescription>All visible runs by status</CardDescription>
          </CardHeader>
          <CardContent>
            <StatusMixChart data={stats.statusMix} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top projects</CardTitle>
            <CardDescription>Most runs first</CardDescription>
          </CardHeader>
          <CardContent>
            <TopProjectsChart orgSlug={org.slug} data={stats.topProjects} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent runs</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 p-0">
            {stats.recentRuns.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              stats.recentRuns.map((r) => (
                <Link
                  key={r.id}
                  href={`/${org.slug}/${r.projectSlug}/runs/${r.id}`}
                  className="flex items-center gap-3 border-b border-border px-5 py-2.5 text-sm last:border-0 hover:bg-muted/40"
                >
                  <StatusBadge status={r.status} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {r.name}
                  </span>
                  <span className="hidden font-mono text-xs text-muted-foreground sm:block">
                    {r.projectSlug}
                  </span>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate(r.startedAt)}
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {isAdmin ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Needs attention</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {stats.crashedWeek.length === 0 &&
              stats.pendingInvites === 0 ? (
                <p className="text-muted-foreground">All quiet.</p>
              ) : (
                <>
                  {stats.crashedWeek.map((r) => (
                    <Link
                      key={r.id}
                      href={`/${org.slug}/${r.projectSlug}/runs/${r.id}`}
                      className="flex items-center justify-between gap-2 hover:underline"
                    >
                      <span className="truncate">{r.name}</span>
                      <span className="shrink-0 text-xs text-warning">
                        crashed {formatDate(r.finishedAt)}
                      </span>
                    </Link>
                  ))}
                  {stats.pendingInvites > 0 && (
                    <Link
                      href={`/${org.slug}/team`}
                      className="text-accent-pale hover:underline"
                    >
                      {stats.pendingInvites} pending invite
                      {stats.pendingInvites === 1 ? "" : "s"}
                    </Link>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">My groups</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {groups.length === 0 ? (
                <p className="text-muted-foreground">
                  No groups yet — ask a super admin to add you.
                </p>
              ) : (
                groups.map((g) => (
                  <Link
                    key={g.id}
                    href={`/${org.slug}/groups/${g.slug}`}
                    className="flex items-center justify-between gap-2 hover:underline"
                  >
                    <span className="truncate">{g.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {g.runCount} run{g.runCount === 1 ? "" : "s"}
                    </span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
