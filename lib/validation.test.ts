import { describe, expect, it } from "vitest";

import { createRunSchema, finishRunSchema, logBatchSchema } from "./validation";

describe("API contract schemas (§6)", () => {
  it("accepts a minimal create-run body", () => {
    expect(createRunSchema.parse({ project: "sage-pretrain" })).toMatchObject({
      project: "sage-pretrain",
    });
  });

  it("rejects an empty log batch and >1000 points", () => {
    expect(() => logBatchSchema.parse({ points: [] })).toThrow();
    const points = Array.from({ length: 1001 }, (_, i) => ({
      key: "train/loss",
      step: i,
      value: 0.5,
    }));
    expect(() => logBatchSchema.parse({ points })).toThrow();
  });

  it("accepts a batched log point", () => {
    const parsed = logBatchSchema.parse({
      points: [{ key: "train/loss", step: 100, value: 0.4 }],
    });
    expect(parsed.points).toHaveLength(1);
  });

  it("accepts Python-isoformat wall_time with +00:00 offset", () => {
    const parsed = logBatchSchema.parse({
      points: [
        {
          key: "train/loss",
          step: 1,
          value: 0.5,
          wall_time: "2026-09-17T17:40:00.123456+00:00",
        },
      ],
    });
    expect(parsed.points).toHaveLength(1);
  });

  it("only allows finished/crashed/killed on finish", () => {
    expect(finishRunSchema.parse({ status: "finished" })).toEqual({
      status: "finished",
    });
    expect(() => finishRunSchema.parse({ status: "done" })).toThrow();
  });
});
