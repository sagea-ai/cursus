"use client";

import Link from "next/link";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function TopProjectsChart({
  orgSlug,
  data,
}: {
  orgSlug: string;
  data: { slug: string; name: string; runs: number }[];
}) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No projects with runs yet.
      </p>
    );
  }
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 8 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={110}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12 }}
            tickFormatter={(name: string) =>
              name.length > 14 ? `${name.slice(0, 13)}…` : name
            }
          />
          <Tooltip
            formatter={(value, _name, item) => [
              `${value} runs`,
              (item?.payload as { slug?: string } | undefined)?.slug ??
                "project",
            ]}
            contentStyle={{ borderRadius: 8, fontSize: 12 }}
          />
          <Bar dataKey="runs" fill="#1976FD" radius={[0, 4, 4, 0]} barSize={16} />
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {data.slice(0, 4).map((p) => (
          <Link
            key={p.slug}
            href={`/${orgSlug}/${p.slug}`}
            className="text-accent-pale hover:underline"
          >
            {p.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
