import { describe, expect, it } from "vitest";

import { computeStreaks } from "@/lib/activity";

function days(counts: number[]) {
  const base = new Date("2026-09-19T00:00:00Z").getTime();
  return counts.map((count, i) => ({
    date: new Date(base - (counts.length - 1 - i) * 86_400_000)
      .toISOString()
      .slice(0, 10),
    count,
  }));
}

describe("computeStreaks", () => {
  it("counts current and longest streaks plus active days", () => {
    expect(computeStreaks(days([0, 1, 1, 0, 1, 1, 1]))).toEqual({
      current: 3,
      longest: 3,
      activeDays: 5,
    });
  });

  it("a quiet today does not break the current streak", () => {
    expect(computeStreaks(days([1, 1, 0]))).toEqual({
      current: 2,
      longest: 2,
      activeDays: 2,
    });
  });

  it("empty history is all zeros", () => {
    expect(computeStreaks(days([0, 0, 0]))).toEqual({
      current: 0,
      longest: 0,
      activeDays: 0,
    });
    expect(computeStreaks([])).toEqual({
      current: 0,
      longest: 0,
      activeDays: 0,
    });
  });
});
