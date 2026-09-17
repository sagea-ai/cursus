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

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Compare view (§7.7): one line per run on every chart, run A's color constant
// across the page, shared legend. Config table shows differing keys only.
const PALETTE = ["#1976FD", "#45AAFD", "#75C4FD", "#FBBF24", "#f2f5fb"];

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
        const metaList: RunMeta[] = [];
        for (const id of ids) {
          const res = await fetch(`/api/v1/runs/${id}`);
          if (!res.ok) throw new Error(`run ${id} not found`);
          const body = await res.json();
          metaList.push({
            id: body.run.id,
            name: body.run.name,
            config: (body.run.config ?? {}) as Record<string, unknown>,
            keys: (body.run.keys ?? []) as string[],
          });
        }
        if (cancelled) return;
        setMetas(metaList);
        const keySet = new Set<string>();
        const perRun: Record<
          string,
          Record<string, { step: number; value: number }[]>
        > = {};
        await Promise.all(
          metaList.map(async (m) => {
            perRun[m.id] = {};
            await Promise.all(
              m.keys.map(async (key) => {
                keySet.add(key);
                const r = await fetch(
                  `/api/v1/runs/${m.id}/metrics?key=${encodeURIComponent(key)}&max_points=2000`,
                );
                if (r.ok) perRun[m.id]![key] = (await r.json()).points ?? [];
              }),
            );
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
  }, [ids]);

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
            <Card key={key}>
              <CardHeader className="p-4 pb-0">
                <CardTitle className="truncate font-mono text-xs font-medium">
                  {key}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-2">
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart
                    data={merged}
                    margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid
                      stroke="#1c2440"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="step"
                      tick={{ fill: "#8b96ad", fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: "#1c2440" }}
                      type="number"
                      domain={["dataMin", "dataMax"]}
                    />
                    <YAxis
                      tick={{ fill: "#8b96ad", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={48}
                      domain={["auto", "auto"]}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#0b0f1a",
                        border: "1px solid #1c2440",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: "#8b96ad" }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
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
              </CardContent>
            </Card>
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
