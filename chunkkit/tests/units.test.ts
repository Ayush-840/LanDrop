import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { resolveCounter, takeTrailing } from "../src/counters.js";
import { chunk } from "../src/index.js";
import { overlapPrefix } from "../src/overlap.js";
import { chunkStream } from "../src/stream.js";

describe("unit internals", () => {
  it("resolveCounter throws on invalid unit", () => {
    expect(() => resolveCounter("tokens" as never)).toThrow(TypeError);
  });
  it("takeTrailing edges", () => {
    expect(takeTrailing("abc", 0, (s) => s.length, "chars")).toBe("");
    expect(takeTrailing("", 5, (s) => s.length, "chars")).toBe("");
    expect(takeTrailing("one two three", 2, (s) => s.length, "words")).toBe("two three");
    expect(takeTrailing("abcdef", 2, (s) => s.length, "chars")).toBe("ef");
  });
  it("overlapPrefix edges", () => {
    expect(overlapPrefix("abc", 0, (s) => s.length, "chars")).toBe("");
    expect(overlapPrefix("", 5, (s) => s.length, "chars")).toBe("");
  });
  it("tight maxSize shrinks chars overlap but never exceeds maxSize", () => {
    const out = chunk("para one here\n\npara two here\n\npara three here", {
      maxSize: 20,
      overlap: 5,
      unit: "chars",
    });
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      if (!c.oversized) expect(c.text.length).toBeLessThanOrEqual(20);
    }
  });
  it("decimals/initials are not sentence boundaries", () => {
    const out = chunk("Version 3.14 is out. Great news here.", { splitOn: "sentence", maxSize: 100 });
    expect(out.map((c) => c.text).join(" ")).toContain("3.14");
  });
  it("leading blank lines before heading", () => {
    const out = chunk("\n\n# H\nbody text", { splitOn: "markdown", maxSize: 100 });
    expect(out.length).toBeGreaterThan(0);
  });
  it("chunkStream accepts Buffer chunks", async () => {
    const stream = Readable.from([Buffer.from("para one"), Buffer.from("\n\npara two")]);
    const got: string[] = [];
    for await (const c of chunkStream(stream, { maxSize: 20 })) got.push(c.text);
    expect(got.length).toBeGreaterThan(0);
  });
});
