"use client";

import * as React from "react";
import { FiEye, FiEyeOff } from "react-icons/fi";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartSection } from "@/components/chart-section";
import { CHART_PALETTE } from "@/components/metric-chart";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface WorkspaceRun {
  id: string;
  name: string;
  status: string;
}

interface OverlayPoint {
  step: number;
  [runId: string]: number | null | undefined;
}

function groupOf(key: string): string {
  const i = key.indexOf("/");
  return i > 0 ? key.slice(0, i) : "metrics";
}

// One overlay chart: fetches the batched series on mount, merges steps
// across runs into a recharts-friendly table, one colored Line per run.
function OverlayChart({
  projectSlug,
  metricKey,
  runs,
}: {
  projectSlug: string;
  metricKey: string;
  runs: WorkspaceRun[];
}) {
  const [series, setSeries] = React.useState<
    { runId: string; name: string; points: { step: number; value: number }[] }[]
  >([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(
          `/api/v1/projects/${projectSlug}/chart?key=${encodeURIComponent(metricKey)}&runs=${runs.map((r) => r.id).join(",")}&max_points=500`,
        );
        if (!res.ok) throw new Error("chart load failed");
        const body = (await res.json()) as {
          series: {
            runId: string;
            name: string;
            points: { step: number; value: number }[];
          }[];
        };
        if (!cancelled) setSeries(body.series);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "load failed");
      }
    }
    if (runs.length > 0) void load();
    return () => {
      cancelled = true;
    };
  }, [projectSlug, metricKey, runs]);

  const { data, colors } = React.useMemo(() => {
    const steps = new Set<number>();
    for (const s of series) for (const p of s.points) steps.add(p.step);
    const ordered = [...steps].sort((a, b) => a - b);
    const byRun = new Map(
      series.map((s) => [
        s.runId,
        new Map(s.points.map((p) => [p.step, p.value] as const)),
      ]),
    );
    return {
      data: ordered.map((step) => {
        const row: OverlayPoint = { step };
        for (const s of series)
          row[s.runId] = byRun.get(s.runId)?.get(step) ?? null;
        return row;
      }),
      colors: new Map(
        series.map((s, i) => [
          s.runId,
          CHART_PALETTE[i % CHART_PALETTE.length]!,
        ]),
      ),
    };
  }, [series]);

  if (error) {
    return <p className="py-4 text-center text-xs text-warning">{error}</p>;
  }
  if (series.length === 0) {
    return (
      <div
        className="h-44 animate-pulse rounded bg-muted/50"
        aria-label="Loading chart"
      />
    );
  }
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
        >
          <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
          <XAxis dataKey="step" tick={{ fontSize: 11 }} type="number" />
          <YAxis tick={{ fontSize: 11 }} width={48} domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{ borderRadius: 8, fontSize: 12 }}
            labelFormatter={(v) => `step ${v}`}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s) => (
            <Line
              key={s.runId}
              type="monotone"
              dataKey={s.runId}
              name={s.name}
              stroke={colors.get(s.runId)}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Project workspace (W&B-style): run picker with color dots on the left,
// per-key overlay charts grouped in collapsible sections on the right.
// Sections fetch their overlay lazily on first expand.
export function WorkspaceView({
  runs,
  metricKeys,
  projectSlug,
}: {
  runs: WorkspaceRun[];
  metricKeys: string[];
  projectSlug: string;
}) {
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>(() =>
    runs.slice(0, Math.min(5, runs.length)).map((r) => r.id),
  );
  const [openSections, setOpenSections] = React.useState<string[]>(() => {
    const first = metricKeys[0];
    const grp = first ? groupOf(first) : null;
    return grp ? [grp] : [];
  });

  const filtered = runs.filter((r) =>
    r.name.toLowerCase().includes(query.toLowerCase()),
  );
  const selectedRuns = React.useMemo(
    () =>
      selected
        .map((id) => runs.find((r) => r.id === id))
        .filter((r): r is WorkspaceRun => Boolean(r))
        .slice(0, 10),
    [selected, runs],
  );
  const colorOf = React.useCallback(
    (id: string) => {
      const i = selectedRuns.findIndex((r) => r.id === id);
      return CHART_PALETTE[(i < 0 ? 0 : i) % CHART_PALETTE.length]!;
    },
    [selectedRuns],
  );

  const groups = React.useMemo(() => {
    const g = new Map<string, string[]>();
    for (const k of metricKeys) {
      const grp = groupOf(k);
      if (!g.has(grp)) g.set(grp, []);
      g.get(grp)!.push(k);
    }
    return [...g.entries()];
  }, [metricKeys]);

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id].slice(0, 10),
    );
  }

  function toggleSection(group: string) {
    setOpenSections((prev) =>
      prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group],
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <div className="flex flex-col gap-2">
        <Input
          placeholder="Search runs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search runs"
        />
        <div className="flex gap-2 text-xs">
          <button
            onClick={() => setSelected(filtered.map((r) => r.id).slice(0, 10))}
            className="text-accent-pale hover:underline"
          >
            Select all
          </button>
          <button
            onClick={() => setSelected([])}
            className="text-accent-pale hover:underline"
          >
            Clear
          </button>
          <span className="ml-auto text-muted-foreground">
            {selectedRuns.length}/10 in overlay
          </span>
        </div>
        <ul className="flex max-h-[560px] flex-col gap-0.5 overflow-y-auto">
          {filtered.map((r) => {
            const on = selected.includes(r.id);
            return (
              <li key={r.id}>
                <button
                  onClick={() => toggle(r.id)}
                  aria-pressed={on}
                  aria-label={`${on ? "Hide" : "Show"} ${r.name} in overlay`}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60",
                    !on && "opacity-55",
                  )}
                >
                  <span
                    className="inline-block size-2.5 shrink-0 rounded-full"
                    style={{ background: on ? colorOf(r.id) : "#a8a29e" }}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {r.name}
                  </span>
                  {on ? (
                    <FiEye className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <FiEyeOff className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="p-3 text-sm text-muted-foreground">
              No runs match.
            </li>
          )}
        </ul>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {selectedRuns.length === 0 && (
          <p className="rounded-md border border-border p-5 text-sm text-muted-foreground">
            Select runs on the left to overlay their metrics.
          </p>
        )}
        {groups.map(([group, keys]) => {
          const open = openSections.includes(group);
          return (
            <ChartSection
              key={group}
              title={group}
              count={keys.length}
              open={open}
              onToggle={() => toggleSection(group)}
            >
              <div className="grid gap-4 xl:grid-cols-2">
                {keys.map((key) => (
                  <div
                    key={key}
                    className="flex flex-col gap-1 rounded-md border border-border p-3"
                  >
                    <p className="truncate font-mono text-xs font-medium">
                      {key}
                    </p>
                    <OverlayChart
                      projectSlug={projectSlug}
                      metricKey={key}
                      runs={selectedRuns}
                    />
                  </div>
                ))}
              </div>
            </ChartSection>
          );
        })}
        {groups.length === 0 && (
          <p className="rounded-md border border-border p-5 text-sm text-muted-foreground">
            No metrics logged in this project yet.
          </p>
        )}
      </div>
    </div>
  );
}
