import { describe, expect, it } from "vitest";
import { chunk, ChunkitError } from "../src/index.js";
import { resolveCounter } from "../src/counters.js";

describe("branch coverage", () => {
  it("resolveCounter accepts custom counters and rejects junk", () => {
    expect(resolveCounter(undefined)("abc")).toBe(3);
    expect(resolveCounter((s) => s.length / 2)("abcd")).toBe(2);
    expect(() => resolveCounter("tokens" as never)).toThrow(TypeError);
    expect(() => resolveCounter(42 as never)).toThrow(TypeError);
  });

  it("overlap skipped when previous chunk empty (defensive)", () => {
    // overlap with empty prev text falls through overlapPrefix's !prevText branch
    const out = chunk("aa\n\nbb", { maxSize: 2, overlap: 1, unit: "chars" });
    expect(out.length).toBeGreaterThan(1);
  });

  it("invalid overlap (negative) throws", () => {
    expect(() => chunk("hi", { overlap: -1 })).toThrow(ChunkitError);
  });

  it("non-integer overlap throws", () => {
    expect(() => chunk("hi", { overlap: 1.5 })).toThrow(ChunkitError);
  });

  it("non-finite / float maxSize throws", () => {
    expect(() => chunk("hi", { maxSize: 1.5 })).toThrow(ChunkitError);
    expect(() => chunk("hi", { maxSize: Number.POSITIVE_INFINITY })).toThrow(ChunkitError);
  });

  it("sentence splitter: abbreviation guard keeps 'St.' intact", () => {
    const out = chunk("Meet me at St. James church", { splitOn: "sentence", maxSize: 100 });
    expect(out.map((c) => c.text).join(" ")).toContain("St. James");
  });

  it("sentence splitter: sentence ending at end-of-input", () => {
    const out = chunk("One sentence here", { splitOn: "sentence", maxSize: 100 });
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("One sentence here");
  });

  it("markdown: line at exact end offset and fence toggling", () => {
    const md = "# T\n\n```\n### not a heading inside fence\n```\n\ntail text";
    const out = chunk(md, { splitOn: "markdown", maxSize: 500 });
    const joined = out.map((c) => c.text).join("\n");
    expect(joined).toContain("### not a heading");
    expect(out.some((c) => c.heading === "# T")).toBe(true);
  });

  it("markdown: oversized section falls back to paragraphs with translated offsets", () => {
    const body = Array.from({ length: 10 }, (_, i) => `para ${i} with words here`).join("\n\n");
    const md = `# Head\n\n${body}`;
    const out = chunk(md, { splitOn: "markdown", maxSize: 60 });
    for (const c of out) {
      if (c.oversized) continue;
      expect(c.text.length).toBeLessThanOrEqual(60);
    }
    expect(out.every((c) => c.heading === "# Head")).toBe(true);
  });

  it("whitespace-only markdown → []", () => {
    expect(chunk("   \n\n  ", { splitOn: "markdown" })).toEqual([]);
  });

  it("empty-input whitespace units (words) via overlap path", () => {
    const out = chunk("word\n\n", { unit: "words", overlap: 1, maxSize: 2 });
    expect(out.length).toBeGreaterThan(0);
  });

  it("chars unit fallback in overlap when custom counter (chars branch)", () => {
    // maxSize 12 leaves room for the 3-char prefix + separator + 6-char body.
    const out = chunk("abcdef\n\nghijkl", { maxSize: 12, overlap: 3, unit: (s) => s.length, splitOn: "paragraph" });
    expect(out[1]!.text.startsWith(out[0]!.text.slice(-3))).toBe(true);
  });

  it("overlap shrinks (or drops) when it would push a chunk past maxSize", () => {
    // maxSize 6 cannot fit prefix + separator + body: cap must drop the prefix.
    const out = chunk("abcdef\n\nghijkl", { maxSize: 6, overlap: 3, splitOn: "paragraph" });
    expect(out[1]!.text).toBe("ghijkl");
    expect(out[1]!.text.length).toBeLessThanOrEqual(6);
  });
});
