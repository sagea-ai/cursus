import Link from "next/link";

import { ActivityChart } from "@/components/activity-chart";
import { ActivityHeatmap } from "@/components/activity-heatmap";
import { QuickstartSnippet } from "@/components/quickstart-snippet";
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

function formatDay(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Server-rendered weekday bars (pure CSS, no client JS): which days of the
// week the runs land on, derived from the year buckets already fetched.
function WeekdayRhythm({ days }: { days: { date: string; count: number }[] }) {
  const perDay = [0, 0, 0, 0, 0, 0, 0];
  for (const d of days) {
    perDay[new Date(`${d.date}T00:00:00Z`).getUTCDay()]! += d.count;
  }
  const max = Math.max(1, ...perDay);
  const peak = perDay.indexOf(max);
  return (
    <div>
      <div className="flex h-32 items-end gap-2">
        {perDay.map((n, i) => (
          <div
            key={WEEKDAYS[i]}
            title={`${WEEKDAYS[i]}: ${plural(n, "run", "runs")}`}
            className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1 self-stretch"
          >
            <span className="text-[11px] text-muted-foreground">
              {n > 0 ? n : ""}
            </span>
            <div
              className={
                i === peak && n > 0
                  ? "w-full rounded-sm bg-accent-pale"
                  : "w-full rounded-sm bg-accent-pale/25"
              }
              style={{ height: `${Math.max(n > 0 ? 6 : 2, (n / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2">
        {WEEKDAYS.map((w) => (
          <span
            key={w}
            className="min-w-0 flex-1 text-center text-[11px] text-muted-foreground"
          >
            {w}
          </span>
        ))}
      </div>
    </div>
  );
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
  const sharePct =
    overview.orgRuns > 0
      ? Math.round((overview.totalRuns / overview.orgRuns) * 100)
      : 0;
  const runningNow = overview.recentRuns.filter((r) => r.status === "RUNNING");
  const runningCount =
    overview.statusMix.find((s) => s.status === "RUNNING")?.count ?? 0;

  // Records + rhythm, all derived from the fetched buckets (zero queries).
  let bestDay = overview.activity[0]!;
  for (const d of overview.activity) {
    if (d.count > bestDay.count) bestDay = d;
  }
  // Grouped from the buckets themselves (never calendar math: a 365-day
  // span can touch 13 calendar months, which crashed .get() on a fixed
  // 12-month window). Oldest stub month drops off via slice(-12).
  const monthly = (() => {
    const byMonth = new Map<string, number>();
    for (const d of overview.activity) {
      const key = d.date.slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + d.count);
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(-12)
      .map(([date, count]) => ({ date, count }));
  })();
  const avgPerActiveDay =
    streaks.activeDays > 0
      ? (overview.totalRuns / streaks.activeDays).toFixed(1)
      : "0";

  const cards = [
    {
      label: "Runs (past year)",
      value: String(overview.totalRuns),
      sub: `+${overview.weekRuns} this week · ${sharePct}%`,
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
      label: "Data points",
      value: formatCount(overview.pointsLogged),
      sub: `metrics logged`,
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
          Runs you started in {org.name} — attribution follows your API key, so
          this is your work alone, not the org&apos;s.
        </p>
      </div>

      {overview.totalRuns === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No runs started by you yet</CardTitle>
            <CardDescription>
              {overview.orgRuns > 0 ? (
                <>
                  {org.name} has {plural(overview.orgRuns, "run", "runs")} so
                  far — but none under your name. Runs count here when
                  they&apos;re logged with{" "}
                  <Link
                    href={`/${org.slug}/settings/keys`}
                    className="text-accent-pale hover:underline"
                  >
                    your API key
                  </Link>
                  . Log one from any training script:
                </>
              ) : (
                <>
                  Your first logged run starts the streak. From any training
                  script:
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <QuickstartSnippet project="demo" />
            <span className="flex flex-wrap gap-3 text-sm">
              <Link
                href={`/${org.slug}/settings/keys`}
                className="text-accent-pale hover:underline"
              >
                Create an API key
              </Link>
              <Link
                href={`/${org.slug}/dashboard`}
                className="text-accent-pale hover:underline"
              >
                View org dashboard
              </Link>
            </span>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
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

      {runningCount > 0 && (
        <Card className="border-accent-pale/40">
          <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4 text-sm">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-pale opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-accent-pale" />
            </span>
            <span className="font-medium">
              {plural(runningCount, "run", "runs")} live now
            </span>
            {runningNow.slice(0, 3).map((r) => (
              <Link
                key={r.id}
                href={`/${org.slug}/${r.projectSlug}/runs/${r.id}`}
                className="text-accent-pale hover:underline"
              >
                {r.name}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

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

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Weekday rhythm</CardTitle>
            <CardDescription>Which days you train</CardDescription>
          </CardHeader>
          <CardContent>
            <WeekdayRhythm days={overview.activity} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly trend</CardTitle>
            <CardDescription>Runs per month, last 12</CardDescription>
          </CardHeader>
          <CardContent>
            <ActivityChart data={monthly} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Records</CardTitle>
            <CardDescription>Personal bests</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">Best day</span>
              <span className="font-medium">
                {formatDay(bestDay.date)} ·{" "}
                {plural(bestDay.count, "run", "runs")}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">Longest run</span>
              <span className="font-medium">
                {formatCompute(overview.longestRunMs)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">Avg per active day</span>
              <span className="font-medium">{avgPerActiveDay}</span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">Share of org</span>
              <span className="font-medium">
                {sharePct}% ({overview.totalRuns} of {overview.orgRuns})
              </span>
            </div>
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
            <TopProjectsChart orgSlug={org.slug} data={overview.topProjects} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent runs</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 p-0">
            {overview.recentRuns.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">Nothing yet.</p>
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
    </main>
  );
}
