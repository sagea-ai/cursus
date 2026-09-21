"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
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

import { Button } from "@/components/ui/button";
import { ChartSection } from "@/components/chart-section";
import { CHART_PALETTE as PALETTE } from "@/components/metric-chart";

// Compare view (§7.7): one line per run on every chart, run A's color constant
// across the page, shared legend. Config table shows differing keys only.

interface RunMeta {
  id: string;
  name: string;
  config: Record<string, unknown>;
  keys: string[];
}

export function CompareView({ basePath }: { basePath: string }) {
  const search = useSearchParams();
  const ids = React.useMemo(
    () => (search.get("ids") ?? "").split(",").filter(Boolean).slice(0, 5),
    [search],
  );
  const [metas, setMetas] = React.useState<RunMeta[]>([]);
  const [series, setSeries] = React.useState<
    Record<string, Record<string, { step: number; value: number }[]>>
  >({});
  const [showAll, setShowAll] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [keys, setKeys] = React.useState<string[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Metas in parallel (the old sequential loop cost N RTTs), then
        // ONE batched overlay request per key instead of N×K metric
        // fetches — the same endpoint the workspace uses.
        const projectSlug = basePath.split("/").filter(Boolean)[1] ?? "";
        const metaList = await Promise.all(
          ids.map(async (id) => {
            const res = await fetch(`/api/v1/runs/${id}`);
            if (!res.ok) throw new Error(`run ${id} not found`);
            const body = await res.json();
            return {
              id: body.run.id as string,
              name: body.run.name as string,
              config: (body.run.config ?? {}) as Record<string, unknown>,
              keys: (body.run.keys ?? []) as string[],
            };
          }),
        );
        if (cancelled) return;
        setMetas(metaList);
        const keySet = new Set<string>();
        for (const m of metaList) for (const k of m.keys) keySet.add(k);
        const perRun: Record<
          string,
          Record<string, { step: number; value: number }[]>
        > = {};
        for (const m of metaList) perRun[m.id] = {};
        await Promise.all(
          [...keySet].map(async (key) => {
            const r = await fetch(
              `/api/v1/projects/${projectSlug}/chart?key=${encodeURIComponent(key)}&runs=${metaList.map((m) => m.id).join(",")}&max_points=2000`,
            );
            if (!r.ok) return;
            const body = (await r.json()) as {
              series: {
                runId: string;
                points: { step: number; value: number }[];
              }[];
            };
            for (const s of body.series) perRun[s.runId]![key] = s.points;
          }),
        );
        if (cancelled) return;
        setSeries(perRun);
        setKeys([...keySet].sort());
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "load failed");
      }
    }
    if (ids.length >= 2) void load();
    return () => {
      cancelled = true;
    };
  }, [ids, basePath]);

  const diffRows = React.useMemo(() => {
    const all = new Set<string>();
    for (const m of metas) for (const k of Object.keys(m.config)) all.add(k);
    return [...all]
      .map((k) => ({
        key: k,
        values: metas.map((m) => JSON.stringify(m.config[k] ?? "—")),
      }))
      .filter((r) => showAll || new Set(r.values).size > 1);
  }, [metas, showAll]);

  if (ids.length < 2) {
    return (
      <p className="py-8 text-sm text-muted-foreground">
        Select at least 2 runs to compare.{" "}
        <Link href={basePath} className="text-accent-pale hover:underline">
          Back to runs
        </Link>
      </p>
    );
  }
  if (error) return <p className="py-8 text-sm text-warning">{error}</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        {metas.map((m, i) => (
          <span key={m.id} className="flex items-center gap-1.5 text-sm">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ background: PALETTE[i % PALETTE.length] }}
            />
            {m.name}
          </span>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {keys.map((key) => {
          const merged = mergeSeries(metas, series, key);
          return (
            <ChartSection key={key} title={key} defaultOpen>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={merged}
                    margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid
                      stroke="#e7e5e0"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="step"
                      tick={{ fill: "#78716c", fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: "#e7e5e0" }}
                      type="number"
                      domain={["dataMin", "dataMax"]}
                    />
                    <YAxis
                      tick={{ fill: "#78716c", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={48}
                      domain={["auto", "auto"]}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#ffffff",
                        border: "1px solid #e5e2dc",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "#1c1917",
                      }}
                      labelStyle={{ color: "#78716c" }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, color: "#57534e" }} />
                    {metas.map((m, i) => (
                      <Line
                        key={m.id}
                        type="monotone"
                        dataKey={m.id}
                        name={m.name}
                        stroke={PALETTE[i % PALETTE.length]}
                        strokeWidth={1.75}
                        dot={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </ChartSection>
          );
        })}
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Config diff</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Show differing only" : "Show all keys"}
          </Button>
        </div>
        {diffRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Selected runs share identical configs.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-mono text-xs text-muted-foreground">
                    key
                  </th>
                  {metas.map((m) => (
                    <th key={m.id} className="px-3 py-2 text-left text-xs">
                      {m.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {diffRows.map((r) => (
                  <tr
                    key={r.key}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {r.key}
                    </td>
                    {r.values.map((v, i) => (
                      <td key={i} className="px-3 py-2 font-mono text-xs">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function mergeSeries(
  metas: RunMeta[],
  series: Record<string, Record<string, { step: number; value: number }[]>>,
  key: string,
): Record<string, number>[] {
  const byStep = new Map<number, Record<string, number>>();
  for (const m of metas) {
    for (const p of series[m.id]?.[key] ?? []) {
      if (!byStep.has(p.step)) byStep.set(p.step, { step: p.step });
      byStep.get(p.step)![m.id] = p.value;
    }
  }
  return [...byStep.values()].sort((a, b) => a.step - b.step);
}
