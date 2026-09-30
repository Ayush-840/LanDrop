import { describe, expect, it } from "vitest";
import { chunk } from "../src/index.js";

describe("edge cases", () => {
  it("empty string → []", () => {
    expect(chunk("")).toEqual([]);
  });
  it("whitespace-only → []", () => {
    expect(chunk("   \n\n  ")).toEqual([]);
  });
  it("single char", () => {
    const out = chunk("x");
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("x");
  });
  it("shorter than maxSize → one chunk", () => {
    expect(chunk("short", { maxSize: 100 })).toHaveLength(1);
  });
  it("single word longer than maxSize → oversized", () => {
    const out = chunk("supercalifragilistic", { maxSize: 5, unit: "chars", splitOn: "paragraph" });
    // "supercalifragilistic" is one paragraph segment > maxSize
    expect(out[0]!.oversized).toBe(true);
    expect(out[0]!.text).toBe("supercalifragilistic");
  });
  it("sentence mode granularity", () => {
    const out = chunk("Hello world. How are you? I am fine.", { maxSize: 20, splitOn: "sentence" });
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) if (!c.oversized) expect(c.text.length).toBeLessThanOrEqual(20);
  });
});
