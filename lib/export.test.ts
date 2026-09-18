import { describe, expect, it } from "vitest";

import { toCsvCell } from "./csv";

describe("toCsvCell", () => {
  it("leaves plain values alone", () => {
    expect(toCsvCell("train/loss")).toBe("train/loss");
    expect(toCsvCell(0.5)).toBe("0.5");
    expect(toCsvCell(100)).toBe("100");
  });

  it("quotes cells with commas, quotes, or newlines", () => {
    expect(toCsvCell("a,b")).toBe('"a,b"');
    expect(toCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(toCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });
});
