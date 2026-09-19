import { describe, expect, it } from "vitest";

import {
  acceptInviteSchema,
  bootstrapSchema,
  createRunSchema,
  finishRunSchema,
  logBatchSchema,
  passwordSchema,
} from "./validation";

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

describe("passwordSchema", () => {
  it("accepts 12+ chars with all four classes", () => {
    expect(passwordSchema.parse("Test-password-1")).toBe("Test-password-1");
  });

  it.each([
    ["short-1A!", "too short"],
    ["longpassword-1", "missing uppercase"],
    ["LONGPASSWORD-1", "missing lowercase"],
    ["Long-password", "missing digit"],
    ["Longpassword1", "missing special"],
  ])("rejects %s (%s)", (pw) => {
    expect(() => passwordSchema.parse(pw)).toThrow();
  });

  it("applies to bootstrap and invite-accept bodies", () => {
    const base = {
      orgName: "o",
      name: "n",
      email: "a@b.co",
      token: "t",
    };
    expect(() =>
      bootstrapSchema.parse({ ...base, password: "weak" }),
    ).toThrow();
    expect(() =>
      acceptInviteSchema.parse({ token: "t", password: "weak" }),
    ).toThrow();
    expect(
      bootstrapSchema.parse({ ...base, password: "Test-password-1" }).password,
    ).toBe("Test-password-1");
  });
});
