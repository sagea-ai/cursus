import type { ActivityDay } from "@/lib/profile";

// Personal-activity math. Pure by design: unit-tested without a database
// (the DB-backed overview lives in lib/profile.ts getActivityOverview).

export interface Streaks {
  /** Consecutive active days ending today (or yesterday if today is idle). */
  current: number;
  longest: number;
  activeDays: number;
}

export function computeStreaks(days: ActivityDay[]): Streaks {
  let longest = 0;
  let run = 0;
  let activeDays = 0;
  for (const day of days) {
    if (day.count > 0) {
      activeDays += 1;
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  // Current streak walks back from the end; a quiet today doesn't break it.
  let current = 0;
  let end = days.length - 1;
  if (end >= 0 && days[end]!.count === 0) end -= 1;
  for (let i = end; i >= 0 && days[i]!.count > 0; i--) current += 1;
  return { current, longest, activeDays };
}
