"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Runs-started-per-day bars. Data is server-aggregated (30 points max);
// this component only renders.
export function ActivityChart({
  data,
}: {
  data: { date: string; count: number }[];
}) {
  const points = data.map((d) => ({
    ...d,
    label: d.date.slice(5).replace("-", "/"),
  }));
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart
        data={points}
        margin={{ top: 4, right: 4, bottom: 0, left: -18 }}
      >
        <XAxis
          dataKey="label"
          tick={{ fill: "#78716c", fontSize: 10 }}
          tickLine={false}
          axisLine={{ stroke: "#e7e5e0" }}
          interval={6}
        />
        <YAxis
          tick={{ fill: "#78716c", fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={40}
          allowDecimals={false}
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
          formatter={(value) => [value, "runs"]}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""}
        />
        <Bar dataKey="count" fill="#1976FD" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
