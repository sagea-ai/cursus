"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const COLORS: Record<string, string> = {
  RUNNING: "#1976FD",
  FINISHED: "#a8a29e",
  CRASHED: "#D97706",
  KILLED: "#57534e",
};

export function StatusMixChart({
  data,
}: {
  data: { status: string; count: number }[];
}) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No runs yet.
      </p>
    );
  }
  return (
    <div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="status"
              innerRadius={48}
              outerRadius={72}
              paddingAngle={2}
              strokeWidth={0}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.status}
                  fill={COLORS[entry.status] ?? "#78716c"}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [`${value} runs`, name]}
              contentStyle={{
                borderRadius: 8,
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-col gap-1 text-xs">
        {data.map((entry) => (
          <li key={entry.status} className="flex items-center gap-2">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ background: COLORS[entry.status] ?? "#78716c" }}
            />
            <span className="font-medium">{entry.status}</span>
            <span className="ml-auto text-muted-foreground">
              {entry.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
