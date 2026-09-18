"use client";

import * as React from "react";
import { FiMaximize2, FiX } from "react-icons/fi";

import { MetricChart, CHART_PALETTE, type ChartDatum } from "@/components/metric-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function groupOf(key: string): string {
  const i = key.indexOf("/");
  return i > 0 ? key.slice(0, i) : "metrics";
}

// Charts tab: one small chart per metric key grouped by prefix (train/*,
// eval/*), polling every 5s for live runs (no websockets in v1). Click a
// chart to expand it full-width.
export function RunCharts({
  runId,
  metricKeys,
  live,
}: {
  runId: string;
  metricKeys: string[];
  live: boolean;
}) {
  const [data, setData] = React.useState<Record<string, ChartDatum[]>>({});
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  // Live polling without websockets (v1): refetch on mount + every 5s while
  // the run is RUNNING. Cancellation flag keeps late responses from
  // overwriting unmounted state.
  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      const entries = await Promise.all(
        metricKeys.map(async (key) => {
          const res = await fetch(
            `/api/v1/runs/${runId}/metrics?key=${encodeURIComponent(key)}&max_points=2000`,
          );
          if (!res.ok) return [key, []] as const;
          const body = await res.json();
          return [key, body.points as ChartDatum[]] as const;
        }),
      );
      if (!cancelled) setData(Object.fromEntries(entries));
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [runId, metricKeys, tick]);

  React.useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [live]);

  const groups = React.useMemo(() => {
    const g = new Map<string, string[]>();
    for (const k of metricKeys) {
      const grp = groupOf(k);
      if (!g.has(grp)) g.set(grp, []);
      g.get(grp)!.push(k);
    }
    return [...g.entries()];
  }, [metricKeys]);

  if (metricKeys.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No metrics logged yet — points appear here live as the run logs them.
      </p>
    );
  }

  const visible: [string, string[]][] = expanded
    ? [[groupOf(expanded), [expanded]]]
    : groups;

  return (
    <div className="flex flex-col gap-6">
      {visible.map(([group, keys]) => (
        <section key={group} className="flex flex-col gap-3">
          {!expanded && (
            <h2 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              {group}
            </h2>
          )}
          <div
            className={
              expanded
                ? "grid gap-4"
                : "grid gap-4 md:grid-cols-2 xl:grid-cols-3"
            }
          >
            {(keys as string[]).map((key, i) => (
              <Card key={key}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 p-4 pb-0">
                  <CardTitle className="truncate font-mono text-xs font-medium">
                    {key}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => setExpanded(expanded ? null : key)}
                    aria-label={expanded ? "Collapse chart" : "Expand chart"}
                  >
                    {expanded ? <FiX /> : <FiMaximize2 />}
                  </Button>
                </CardHeader>
                <CardContent className="p-4 pt-2">
                  <MetricChart
                    data={data[key] ?? []}
                    color={CHART_PALETTE[i % CHART_PALETTE.length]}
                    height={expanded ? 420 : 180}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
