import { describe, expect, it } from "vitest";
import { chunk } from "../src/index.js";

const MD = `# Intro
Welcome to the guide.

## Setup
Install the package first.

Run the init command.

## Usage
Chunk your docs here.
`;

describe("markdown", () => {
  it("attaches headings", () => {
    const out = chunk(MD, { maxSize: 200, splitOn: "markdown" });
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((c) => c.heading)).toBe(true);
  });

  it("keeps heading with its section", () => {
    const out = chunk("# Title\nBody text here.", { maxSize: 1000, splitOn: "markdown" });
    expect(out[0]!.text).toContain("# Title");
  });

  it("falls back to paragraph within oversized section", () => {
    const big = "# Big\n" + Array.from({ length: 30 }, (_, i) => `paragraph ${i} with content`).join("\n\n");
    const out = chunk(big, { maxSize: 100, splitOn: "markdown" });
    for (const c of out) {
      if (!c.oversized) expect(c.text.length).toBeLessThanOrEqual(100);
      expect(c.heading).toBe("# Big");
    }
  });

  it("never splits inside code fences", () => {
    const md = "# Doc\nIntro.\n\n```js\nline1\nline2\nline3\n```\n\nOutro paragraph here.";
    const out = chunk(md, { maxSize: 1000, splitOn: "markdown" });
    const joined = out.map((c) => c.text).join("\n");
    expect(joined).toContain("line1\nline2\nline3");
  });
});
