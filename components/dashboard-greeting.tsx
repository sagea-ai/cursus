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
// The selected greeting persists for the browser session.
//
// Hydration-safe by construction: the server snapshot is always the
// neutral fallback (so SSR HTML matches the first client render), and
// the client snapshot resolves once at module load. No setState in an
// effect, no server/client branch during render.
const FALLBACK_GREETING = "Hello there";
const STORAGE_KEY = "dashboard-greeting";

function pickGreeting(): string {
  const part = getGreetingPart(new Date().getHours());
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (stored) return stored;
  const picked = getRandomGreeting(part);
  sessionStorage.setItem(STORAGE_KEY, picked);
  return picked;
}

function pickToday(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// Module state is per-environment: the server copy stays null (no window
// access at module scope on the server), the client copy resolves once
// when the chunk loads, before first render.
const clientGreeting: string | null =
  typeof window === "undefined" ? null : pickGreeting();
const clientToday: string | null =
  typeof window === "undefined" ? null : pickToday();

function subscribeGreeting() {
  return () => { };
}

export function DashboardGreeting({ name }: { name: string }) {
  const greeting = React.useSyncExternalStore(
    subscribeGreeting,
    () => clientGreeting ?? FALLBACK_GREETING,
    () => FALLBACK_GREETING,
  );
  const today = React.useSyncExternalStore(
    subscribeGreeting,
    () => clientToday ?? "",
    () => "",
  );

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