import Link from "next/link";

import { ActivityChart } from "@/components/activity-chart";
import { ActivityHeatmap } from "@/components/activity-heatmap";
import { CodeBlock } from "@/components/code-block";
import { StatusBadge } from "@/components/status-badge";
import { StatusMixChart } from "@/components/status-mix-chart";
import { TopProjectsChart } from "@/components/top-projects-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requirePageSession } from "@/lib/page-auth";
import { getActivityOverview } from "@/lib/profile";

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

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org: orgSlug } = await params;
  const { session, org, displayName } = await requirePageSession(orgSlug);
  const overview = await getActivityOverview(session);
  const { streaks } = overview;
  const crashRate =
    overview.totalRuns > 0
      ? Math.round((overview.crashed / overview.totalRuns) * 100)
      : 0;

  const cards = [
    {
      label: "Runs (past year)",
      value: String(overview.totalRuns),
      sub: `+${overview.weekRuns} this week`,
    },
    {
      label: "Active days",
      value: String(streaks.activeDays),
      sub: `of the last 365`,
    },
    {
      label: "Current streak",
      value: plural(streaks.current, "day", "days"),
      sub: `longest ${plural(streaks.longest, "day", "days")}`,
    },
    {
      label: "Compute",
      value: formatCompute(overview.totalComputeMs),
      sub: `across ${overview.totalRuns} runs`,
    },
    {
      label: "Crashed",
      value: String(overview.crashed),
      sub: `${crashRate}% of runs`,
    },
  ];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Your activity, {displayName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every run you started in {org.name} — streaks, compute, and where the
          work went.
        </p>
      </div>

      {overview.totalRuns === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No runs yet</CardTitle>
            <CardDescription>
              Your first logged run starts the streak. From any training script:
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
            <Link
              href={`/${org.slug}/settings/keys`}
              className="text-sm text-accent-pale hover:underline"
            >
              Create an API key
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contribution grid</CardTitle>
              <CardDescription>
                Runs you started per day, last 365 days
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ActivityHeatmap days={overview.activity} />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Last 30 days</CardTitle>
                <CardDescription>Runs started per day</CardDescription>
              </CardHeader>
              <CardContent>
                <ActivityChart data={overview.activity.slice(-30)} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Status mix</CardTitle>
                <CardDescription>Your runs by status</CardDescription>
              </CardHeader>
              <CardContent>
                <StatusMixChart data={overview.statusMix} />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top projects</CardTitle>
                <CardDescription>Where your runs went</CardDescription>
              </CardHeader>
              <CardContent>
                <TopProjectsChart
                  orgSlug={org.slug}
                  data={overview.topProjects}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent runs</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 p-0">
                {overview.recentRuns.length === 0 ? (
                  <p className="p-5 text-sm text-muted-foreground">
                    Nothing yet.
                  </p>
                ) : (
                  overview.recentRuns.map((r) => (
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
          </div>
        </>
      )}
    </main>
  );
}
