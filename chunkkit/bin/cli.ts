#!/usr/bin/env node
/** chunkkit CLI: npx chunkkit file.md --max-size 500 */
import { readFileSync } from "node:fs";
import { chunk } from "../src/index.js";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const pref = process.argv.find((a) => a.startsWith(name + "="));
  if (pref) return pref.split("=").slice(1).join("=");
  return def;
}

const file = process.argv[2];
if (!file || file.startsWith("-")) {
  console.error("Usage: chunkkit <file> [--max-size N] [--overlap N] [--unit chars|words] [--split-on paragraph|sentence|markdown] [--json]");
  process.exit(1);
}
const maxSize = Number(arg("--max-size", "500"));
const overlap = Number(arg("--overlap", "0"));
const unit = (arg("--unit", "chars") as "chars" | "words") ?? "chars";
const splitOn = (arg("--split-on", arg("--splitOn", "paragraph")) as "paragraph" | "sentence" | "markdown") ?? "paragraph";
const asJson = process.argv.includes("--json");

const text = readFileSync(file, "utf8");
const chunks = chunk(text, { maxSize, overlap, unit, splitOn });
if (asJson) {
  console.log(JSON.stringify(chunks, null, 2));
} else {
  for (const c of chunks) {
    console.log(`--- chunk ${c.index} [${c.start}-${c.end}]${c.heading ? " " + c.heading : ""}${c.oversized ? " OVERSIZED" : ""} ---`);
    console.log(c.text);
    console.log();
  }
  console.error(`${chunks.length} chunk(s)`);
}
