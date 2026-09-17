import { describe, expect, it } from "vitest";

import { mergeSummary } from "./summary";

describe("mergeSummary", () => {
  it("adds new keys and overwrites with last-known values", () => {
    expect(
      mergeSummary({ "train/loss": 0.9 }, [
        { key: "train/loss", value: 0.4 },
        { key: "train/lr", value: 0.001 },
      ]),
    ).toEqual({ "train/loss": 0.4, "train/lr": 0.001 });
  });

  it("ignores empty keys and non-finite values", () => {
    expect(
      mergeSummary({}, [
        { key: "", value: 1 },
        { key: "x", value: Number.NaN },
        { key: "y", value: Number.POSITIVE_INFINITY },
      ]),
    ).toEqual({});
  });

  it("does not mutate the input", () => {
    const existing = { a: 1 };
    mergeSummary(existing, [{ key: "a", value: 2 }]);
    expect(existing).toEqual({ a: 1 });
  });
});
