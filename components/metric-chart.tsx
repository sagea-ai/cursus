"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Single metric-chart component for run detail + compare.
// Recharts under the hood, SAGEA-on-light styling. Payloads are already
// server-downsampled (max_points) — this component just renders.
export interface ChartDatum {
  step: number;
  value: number;
}

/** Line colors, one per run/series. Run A keeps its color across a page.
 * First five are the original set (existing views unchanged); the rest
 * extend overlays to 10 runs with distinct hues. */
export const CHART_PALETTE = [
  "#1976FD",
  "#0050FD",
  "#45AAFD",
  "#D97706",
  "#1C1917",
  "#16A34A",
  "#9333EA",
  "#DB2777",
  "#0D9488",
  "#78716C",
];

export function MetricChart({
  data,
  color = "#1976FD",
  height = 180,
  syncId,
  hideAxes = false,
}: {
  data: ChartDatum[];
  color?: string;
  height?: number;
  syncId?: string;
  hideAxes?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart
        data={data}
        syncId={syncId}
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
          hide={hideAxes}
          type="number"
          domain={["dataMin", "dataMax"]}
        />
        <YAxis
          tick={{ fill: "#78716c", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          hide={hideAxes}
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
          formatter={(value) => [
            typeof value === "number" ? value.toPrecision(6) : value,
            "",
          ]}
          labelFormatter={(step) => `step ${step}`}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.75}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
