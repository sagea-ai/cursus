"use client";

import * as React from "react";

const greetings = {
  morning: [
    "Good morning",
    "Morning",
    "Good morning, researcher",
    "Ready to run",
    "Ready for another run",
    "Let's get training",
    "Time to experiment",
    "New day, new experiments",
  ],
  afternoon: [
    "Back to the experiments",
    "Let's keep training",
    "Ready for another run",
    "Keep experimenting",
    "Time to iterate",
    "Let's see what converges",
  ],
  night: [
    "Good evening",
    "Evening",
    "Working late",
    "Still experimenting",
    "One more run",
    "Late night, long runs",
    "Let it train",
    "While the GPUs are warm",
  ],
} as const;

type GreetingPart = keyof typeof greetings;

function getGreetingPart(hour: number): GreetingPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "night";
}

function getRandomGreeting(part: GreetingPart) {
  const options = greetings[part];
  return options[Math.floor(Math.random() * options.length)];
}

// Time-of-day greeting in the viewer's timezone.
// The selected greeting persists for the browser session. Lazy state
// initializers (client-guarded) replace the mount-effect pattern: the
// server still renders the neutral fallback, the client picks on first
// render, with no synchronous setState inside an effect.
function initGreeting(): string {
  if (typeof window === "undefined") return "Welcome back";
  const part = getGreetingPart(new Date().getHours());
  const storageKey = "dashboard-greeting";
  const stored = sessionStorage.getItem(storageKey);
  if (stored) return stored;
  const picked = getRandomGreeting(part);
  sessionStorage.setItem(storageKey, picked);
  return picked;
}

function initToday(): string {
  if (typeof window === "undefined") return "";
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function DashboardGreeting({ name }: { name: string }) {
  const [greeting] = React.useState(initGreeting);
  const [today] = React.useState(initToday);

  return (
    <div>
      <h1 className="text-2xl font-semibold">
        {greeting}, {name}
      </h1>

      <p className="text-xs text-muted-foreground">
        {today}
      </p>
    </div>
  );
}