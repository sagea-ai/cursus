import { describe, expect, it } from "vitest";

import { downsample } from "./downsampling";

describe("downsample", () => {
  it("returns points unchanged when under the limit", () => {
    const pts = [
      { step: 0, value: 1 },
      { step: 1, value: 2 },
    ];
    expect(downsample(pts, 100)).toEqual(pts);
  });

  it("bounds output length regardless of input size", () => {
    const pts = Array.from({ length: 100_000 }, (_, i) => ({
      step: i,
      value: Math.sin(i / 100),
    }));
    const out = downsample(pts, 2000);
    expect(out.length).toBeLessThanOrEqual(2000);
    // Always keeps the endpoints so charts don't lie about run extent.
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("keeps a single trailing point when maxPoints is 1", () => {
    const pts = [
      { step: 0, value: 1 },
      { step: 5, value: 9 },
    ];
    expect(downsample(pts, 1)).toEqual([{ step: 5, value: 9 }]);
  });

  it("rejects maxPoints < 1", () => {
    expect(() => downsample([{ step: 0, value: 0 }], 0)).toThrow();
  });
});
