#!/usr/bin/env node
/** chunkkit CLI: npx @ayush-840/chunkkit file.md --max-size 500 */
import { readFileSync } from "node:fs";
import { chunk, ChunkitError } from "../src/index.js";

const HELP = `chunkkit — structure-aware text chunking for RAG & LLM pipelines

Usage:
  chunkkit <file> [options]
  chunkkit --help
  cat file.md | chunkkit - [options]

Options:
  --max-size <n>     maximum chunk size in units (default 500)
  --overlap <n>      trailing units repeated in the next chunk (default 0)
  --unit <name>      chars | words (default chars)
  --split-on <name>  paragraph | sentence | markdown (default paragraph)
  --json             print NDJSON, one chunk object per line
  -h, --help         show this help

Examples:
  chunkkit notes.md --max-size 500 --split-on markdown
  chunkkit report.txt --max-size 200 --overlap 20 --unit words --json`;

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const pref = process.argv.find((a) => a.startsWith(name + "="));
  if (pref) return pref.split("=").slice(1).join("=");
  return def;
}

function fail(message: string, hint?: string): never {
  console.error(`✖ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help") || argv.length === 0) {
  console.log(HELP);
  process.exit(argv.length === 0 ? 1 : 0);
}

const file = argv[0]!;
if (file.startsWith("-") && file !== "-") fail(`unknown option ${file}`, "run `chunkkit --help` for usage");

const numOpt = (name: string, def: number): number => {
  const raw = arg(name);
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) fail(`--${name.slice(2)} must be a number, got "${raw}"`);
  return n;
};

const maxSize = numOpt("--max-size", 500);
const overlap = numOpt("--overlap", 0);
const unitRaw = arg("--unit", "chars")!;
const splitOnRaw = arg("--split-on", arg("--splitOn", "paragraph"))!;
if (unitRaw !== "chars" && unitRaw !== "words")
  fail(`--unit must be "chars" or "words", got "${unitRaw}"`);
if (!["paragraph", "sentence", "markdown"].includes(splitOnRaw))
  fail(`--split-on must be "paragraph", "sentence" or "markdown", got "${splitOnRaw}"`);
const asJson = argv.includes("--json");

let text: string;
try {
  if (file === "-") {
    text = readFileSync(0, "utf8"); // stdin
  } else {
    text = readFileSync(file, "utf8");
  }
} catch (err) {
  const e = err as NodeJS.ErrnoException;
  if (e.code === "ENOENT") fail(`file not found: ${file}`);
  if (e.code === "EISDIR") fail(`${file} is a directory, not a file`);
  fail(`cannot read ${file}: ${e.message ?? e}`);
}

let chunks;
try {
  chunks = chunk(text, { maxSize, overlap, unit: unitRaw, splitOn: splitOnRaw as "paragraph" | "sentence" | "markdown" });
} catch (err) {
  if (err instanceof ChunkitError) fail(`${err.message}`, `check --max-size / --overlap / --unit / --split-on`);
  throw err;
}

if (asJson) {
  for (const c of chunks) console.log(JSON.stringify(c));
} else {
  for (const c of chunks) {
    console.log(
      `--- chunk ${c.index} [${c.start}-${c.end}]${c.heading ? " " + c.heading : ""}${c.oversized ? " OVERSIZED" : ""} ---`,
    );
    console.log(c.text);
    console.log();
  }
  console.error(`${chunks.length} chunk(s)`);
}
