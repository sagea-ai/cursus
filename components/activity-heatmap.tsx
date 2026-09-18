import type { ActivityDay } from "@/lib/profile";

// GitHub-style contribution grid, server-rendered (no JS needed): weeks as
// columns, Sunday-to-Saturday rows, month labels where the month turns.
const SCALE = ["#eceae6", "#bcd7fd", "#7db4fc", "#3d8bfd", "#0050fd"];

function colorFor(count: number): string {
  if (count <= 0) return SCALE[0]!;
  if (count <= 2) return SCALE[1]!;
  if (count <= 5) return SCALE[2]!;
  if (count <= 9) return SCALE[3]!;
  return SCALE[4]!;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function ActivityHeatmap({ days }: { days: ActivityDay[] }) {
  const weeks: (ActivityDay | null)[][] = [];
  if (days.length > 0) {
    let cur: (ActivityDay | null)[] = [];
    const firstDow = new Date(`${days[0]!.date}T00:00:00Z`).getUTCDay();
    for (let i = 0; i < firstDow; i++) cur.push(null);
    for (const d of days) {
      cur.push(d);
      if (cur.length === 7) {
        weeks.push(cur);
        cur = [];
      }
    }
    if (cur.length > 0) {
      while (cur.length < 7) cur.push(null);
      weeks.push(cur);
    }
  }
  let lastMonth = -1;

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-[3px]">
        {weeks.map((week, wi) => {
          const firstReal = week.find((d) => d !== null);
          const month = firstReal ? Number(firstReal.date.slice(5, 7)) - 1 : -1;
          const label = month !== lastMonth && month >= 0 ? MONTHS[month] : "";
          if (month >= 0) lastMonth = month;
          return (
            <div key={wi} className="flex flex-col gap-[3px]">
              <span className="h-3 text-[9px] leading-3 text-muted-foreground">
                {label}
              </span>
              {week.map((day, di) => (
                <span
                  key={di}
                  title={
                    day
                      ? `${day.count} run${day.count === 1 ? "" : "s"} on ${day.date}`
                      : ""
                  }
                  style={{
                    background: day ? colorFor(day.count) : "transparent",
                  }}
                  className="size-[10px] rounded-[2px]"
                />
              ))}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
        Less
        {SCALE.map((c) => (
          <span
            key={c}
            style={{ background: c }}
            className="size-[10px] rounded-[2px]"
          />
        ))}
        More
      </div>
    </div>
  );
}
