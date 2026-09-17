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

// Single metric-chart component for run detail + compare (PRD §10.1).
// Recharts under the hood, SAGEA-on-dark styling. Payloads are already
// server-downsampled (max_points) — this component just renders.
export interface ChartDatum {
  step: number;
  value: number;
}

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
          stroke="#1c2440"
          strokeDasharray="3 3"
          vertical={false}
        />
        <XAxis
          dataKey="step"
          tick={{ fill: "#8b96ad", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#1c2440" }}
          hide={hideAxes}
          type="number"
          domain={["dataMin", "dataMax"]}
        />
        <YAxis
          tick={{ fill: "#8b96ad", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          hide={hideAxes}
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
