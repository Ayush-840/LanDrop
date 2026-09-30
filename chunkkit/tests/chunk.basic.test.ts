import { describe, expect, it } from "vitest";
import { chunk } from "../src/index.js";

describe("chunk basic", () => {
  it("one-liner works with defaults", () => {
    const out = chunk("hello world");
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("hello world");
    expect(out[0].index).toBe(0);
  });

  it("never exceeds maxSize (chars)", () => {
    const text = Array.from({ length: 20 }, (_, i) => `paragraph number ${i} with some words`).join("\n\n");
    const out = chunk(text, { maxSize: 100, unit: "chars" });
    for (const c of out) expect(c.text.length).toBeLessThanOrEqual(100);
  });

  it("never exceeds maxSize (words)", () => {
    const text = Array.from({ length: 30 }, (_, i) => `sentence ${i} has several words in it`).join(" ");
    const out = chunk(text, { maxSize: 20, unit: "words", splitOn: "sentence" });
    for (const c of out) {
      if (c.oversized) continue;
      expect(c.text.trim().split(/\s+/).length).toBeLessThanOrEqual(20);
    }
  });

  it("deterministic output", () => {
    const text = "a\n\nb\n\nc\n\nd";
    expect(chunk(text, { maxSize: 5 })).toEqual(chunk(text, { maxSize: 5 }));
  });

  it("custom counter function", () => {
    const out = chunk("aa bb cc dd", { maxSize: 2, unit: () => 1 });
    expect(out.length).toBeGreaterThan(0);
  });

  it("start/end map back to source", () => {
    const text = "first paragraph\n\nsecond paragraph";
    const out = chunk(text, { maxSize: 100 });
    for (const c of out) {
      expect(text.slice(c.start, c.end).length).toBeGreaterThan(0);
    }
  });
});
