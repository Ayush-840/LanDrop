import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * End-to-end CLI tests: spawn the BUILT bundle (dist/cli.js), the exact
 * artifact npm users and npx execute, so a broken build — a doubled
 * shebang, a bad import, a syntax error — can never pass tests or publish.
 * CI runs `npm run build` before these tests; the guard below fails fast
 * with a clear message if it hasn't.
 */
const CLI = join(__dirname, "../dist/cli.js");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], input?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

beforeAll(() => {
  if (!existsSync(CLI)) {
    throw new Error(
      `dist/cli.js not found — run \`npm run build\` before testing the CLI`,
    );
  }
});

describe("cli: happy paths", () => {
  it("--help prints usage and exits 0", async () => {
    const r = await run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Usage:");
    expect(r.stdout).toContain("--max-size");
  });

  it("-h works too", async () => {
    const r = await run(["-h"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("chunkkit");
  });

  it("chunks a file and prints boundaries", async () => {
    const r = await run(["tests/fixtures/sample.md", "--max-size", "60"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("--- chunk 0 [");
    expect(r.stderr).toMatch(/\d+ chunk\(s\)/);
  });

  it("reads from stdin via -", async () => {
    const r = await run(["-", "--max-size", "10"], "para one\n\npara two");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("para one");
    expect(r.stdout).toContain("para two");
  });

  it("--json emits one JSON object per line (NDJSON)", async () => {
    const r = await run(["tests/fixtures/sample.md", "--max-size", "60", "--json"]);
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed[0]).toMatchObject({ index: 0 });
    expect(parsed[0]).toHaveProperty("start");
    expect(parsed[0]).toHaveProperty("end");
  });

  it("honours --unit words and --split-on markdown", async () => {
    const r = await run([
      "tests/fixtures/sample.md",
      "--max-size",
      "30",
      "--unit",
      "words",
      "--split-on",
      "markdown",
      "--json",
    ]);
    expect(r.code).toBe(0);
    const parsed = r.stdout
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { text: string; heading?: string });
    expect(parsed.some((c) => c.heading?.startsWith("#"))).toBe(true);
  });

  it("empty stdin produces no chunks and exits 0", async () => {
    const r = await run(["-", "--max-size", "10"], "");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  });
});

describe("cli: error paths (all exit 1 with ✖ message)", () => {
  it("missing file", async () => {
    const r = await run(["definitely-missing.md"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("file not found");
    expect(r.stderr).toContain("definitely-missing.md");
  });

  it("unknown option", async () => {
    const r = await run(["--bogus"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unknown option --bogus");
    expect(r.stderr).toContain("--help");
  });

  it("non-numeric --max-size", async () => {
    const r = await run(["tests/fixtures/sample.md", "--max-size", "abc"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("--max-size must be a number");
  });

  it("invalid --unit", async () => {
    const r = await run(["tests/fixtures/sample.md", "--unit", "tokens"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('--unit must be "chars" or "words"');
  });

  it("invalid --split-on", async () => {
    const r = await run(["tests/fixtures/sample.md", "--split-on", "lines"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('--split-on must be "paragraph", "sentence" or "markdown"');
  });

  it("invalid overlap (>= maxSize) surfaces ChunkitError", async () => {
    const r = await run(["tests/fixtures/sample.md", "--max-size", "10", "--overlap", "10"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("overlap");
  });

  it("no arguments prints help to stdout and exits 1", async () => {
    const r = await run([]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("Usage:");
  });
});

describe("cli: build sanity", () => {
  it("bundle starts with exactly one shebang (regression: doubled shebang crashed every run)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(CLI, "utf8");
    const lines = src.split("\n");
    expect(lines[0]).toBe("#!/usr/bin/env node");
    // No second shebang anywhere in the bundle.
    expect(lines.slice(1).some((l) => l.startsWith("#!"))).toBe(false);
  });
});

afterAll(() => {
  /* nothing to clean up — every spawn exits on its own */
});
