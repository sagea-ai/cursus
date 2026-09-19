"use client";

import * as React from "react";

// Time-of-day greeting in the VIEWER's timezone. Mount-guarded: the server
// renders a neutral greeting first, the client swaps it after hydration, so
// there is never a hydration mismatch (and UTC server time never leaks in).
export function DashboardGreeting({ name }: { name: string }) {
  const [hour, setHour] = React.useState<number | null>(null);
  React.useEffect(() => {
    setHour(new Date().getHours());
  }, []);
  const part =
    hour === null
      ? "Welcome back"
      : hour < 5
        ? "Working late"
        : hour < 12
          ? "Good morning"
          : hour < 18
            ? "Good afternoon"
            : "Good evening";
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return (
    <div>
      <h1 className="text-2xl font-semibold">
        {part}, {name}
      </h1>
      <p className="text-xs text-muted-foreground">{today}</p>
    </div>
  );
}
