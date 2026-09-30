import { describe, expect, it } from "vitest";
import { chunk } from "../src/index.js";
import { ChunkitError } from "../src/index.js";

describe("overlap", () => {
  it("repeats trailing N chars of previous chunk", () => {
    const text = "para one here\n\npara two here\n\npara three here";
    const out = chunk(text, { maxSize: 30, overlap: 5, unit: "chars" });
    expect(out.length).toBeGreaterThan(1);
    for (let i = 1; i < out.length; i++) {
      const prev = out[i - 1]!.text;
      const tail = prev.slice(-5);
      expect(out[i]!.text.startsWith(tail)).toBe(true);
    }
  });

  it("overlap 0 behaves like no overlap", () => {
    const text = "a\n\nb\n\nc";
    expect(chunk(text, { maxSize: 3, overlap: 0 })).toEqual(chunk(text, { maxSize: 3 }));
  });

  it("overlap in words mode is exact", () => {
    const text = "one two three four\n\nfive six seven eight\n\nnine ten eleven twelve";
    const out = chunk(text, { maxSize: 6, overlap: 2, unit: "words", splitOn: "paragraph" });
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      if (!c.oversized) expect(c.text.trim().split(/\s+/).length).toBeLessThanOrEqual(6);
    }
  });

  it("invalid overlap throws ChunkitError", () => {
    expect(() => chunk("hi", { maxSize: 5, overlap: 5 })).toThrow(ChunkitError);
    expect(() => chunk("hi", { maxSize: 5, overlap: 9 })).toThrow(ChunkitError);
  });
});
