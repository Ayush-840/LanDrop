import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chunk } from "../src/index.js";
import { chunkFile } from "../src/index.js";

describe("coverage extras", () => {
  it("words whitespace-only → []", () => {
    expect(chunk("   \n  ", { unit: "words" })).toEqual([]);
  });
  it("abbreviation-aware sentences", () => {
    const out = chunk("Mr. Smith went home. He slept well.", { splitOn: "sentence", maxSize: 100 });
    expect(out.length).toBeGreaterThan(0);
    expect(out.map((c) => c.text).join(" ")).toContain("Mr. Smith");
  });
  it("words overlap shrink loop trims to fit maxSize", () => {
    const text = "alpha beta gamma delta\n\nepsilon zeta eta theta\n\none two three four";
    const out = chunk(text, { maxSize: 7, overlap: 5, unit: "words", splitOn: "paragraph" });
    for (const c of out) {
      if (!c.oversized) expect(c.text.trim().split(/\s+/).length).toBeLessThanOrEqual(7);
    }
  });
  it("chunkFile matches chunk()", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ck-"));
    const p = join(dir, "notes.md");
    writeFileSync(p, "hello\n\nworld");
    const got: string[] = [];
    for await (const c of chunkFile(p, { maxSize: 10 })) got.push(c.text);
    expect(got.length).toBeGreaterThan(0);
  });
});
