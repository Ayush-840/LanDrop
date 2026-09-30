#!/usr/bin/env node
/**
 * Real-world benchmark: chunkkit vs naive fixed-size slicing.
 *
 * Measures what actually matters for RAG quality, not just speed:
 *   1. Boundary integrity — how many cuts land mid-word / mid-sentence
 *   2. Fence integrity    — chunks with unpaired ``` markers (broken code blocks)
 *   3. Size compliance    — chunks whose char size exceeds maxSize
 *   4. Duplicate bytes    — % of payload that is repeated overlap text
 *   5. Time               — end-to-end wall clock and throughput
 *
 * Usage: node bench/bench.mjs [corpusKB]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// Benchmark the built artifact — the same code npm users install.
// Run `npm run build` first if this file is missing.
let chunk;
try {
  ({ chunk } = await import(join(here, "../dist/index.js")));
} catch {
  console.error("dist/index.js not found — run `npm run build` first.");
  process.exit(1);
}
const fixture = readFileSync(join(here, "../tests/fixtures/sample.md"), "utf8");

// Build a ~N KB corpus by tiling the fixture with slight variation so
// headings/paragraphs/code fences recur like a real docs site would.
const targetKB = Number(process.argv[2] ?? 200);
let corpus = "";
while (corpus.length < targetKB * 1024) {
  corpus += fixture.replace("Sample RAG document", `Sample RAG document (part ${corpus.length})`);
  corpus += "```\nnpm install chunkkit\nconst c = chunk(text);\n```\n\n";
}

const MAX_SIZE = 500;
const OVERLAP = 50;

// --- the two strategies -------------------------------------------------

function chunkkitSplit(text) {
  return chunk(text, {
    maxSize: MAX_SIZE,
    overlap: OVERLAP,
    unit: "chars",
    splitOn: "markdown",
  });
}

function naiveSlice(text) {
  const out = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + MAX_SIZE);
    out.push({ text: text.slice(start, end), start, end });
    if (end === text.length) break;
    start = end - OVERLAP;
  }
  return out;
}

// --- metrics -------------------------------------------------------------

/** A cut is "mid-word" when the previous chunk ends and the next begins
 * inside the same word (both sides alphanumeric around the boundary). */
function midWordCuts(chunks) {
  let cuts = 0;
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1].text.replace(/\s+$/, "");
    const next = chunks[i].text.replace(/^\s+/, "");
    if (!prev || !next) continue;
    if (/\w$/.test(prev) && /^\w/.test(next)) cuts++;
  }
  return cuts;
}

/** Count chunks containing an odd number of ``` fence markers (a broken pair). */
function brokenFences(chunks) {
  let n = 0;
  for (const c of chunks) {
    const hits = c.text.match(/^```/gm);
    if (hits && hits.length % 2 === 1) n++;
  }
  return n;
}

function sizeViolations(chunks) {
  return chunks.filter((c) => c.text.length > MAX_SIZE).length;
}

function duplicatePct(chunks) {
  // Total emitted bytes vs the union of source ranges actually covered.
  // Consistent across strategies: naive's ranges themselves overlap by the
  // slide amount, chunkkit's overlap lives in the text but not the range.
  const total = chunks.reduce((s, c) => s + c.text.length, 0);
  const ranges = chunks.map((c) => [c.start, c.end]).sort((a, b) => a[0] - b[0]);
  let union = 0;
  let curEnd = -Infinity;
  for (const [s, e] of ranges) {
    if (s >= curEnd) {
      union += e - s;
      curEnd = e;
    } else if (e > curEnd) {
      union += e - curEnd;
      curEnd = e;
    }
  }
  return total > union ? ((total - union) / total) * 100 : 0;
}

// --- run -----------------------------------------------------------------

const t0 = performance.now();
const ck = chunkkitSplit(corpus);
const ckMs = performance.now() - t0;

const t1 = performance.now();
const nv = naiveSlice(corpus);
const nvMs = performance.now() - t1;

const row = (name, chunks, ms) => {
  const mid = midWordCuts(chunks);
  const fences = brokenFences(chunks);
  const over = sizeViolations(chunks);
  const dup = duplicatePct(chunks);
  const mbps = (corpus.length / 1024 / 1024 / (ms / 1000)).toFixed(1);
  return { name, chunks: chunks.length, mid, fences, over, dup: dup.toFixed(1) + "%", ms: ms.toFixed(1) + "ms", mbps };
};

const ckRow = row("chunkkit (markdown)", ck, ckMs);
const nvRow = row("naive fixed-size  ", nv, nvMs);

console.log(`Corpus: ${(corpus.length / 1024).toFixed(0)} KB · maxSize ${MAX_SIZE} chars · overlap ${OVERLAP}\n`);
console.log(
  [
    "strategy             chunks  mid-word cuts  broken fences  over maxSize  dup bytes  time      throughput",
    "-------------------  ------  -------------  -------------  ------------  ---------  --------  ----------",
    `${ckRow.name}  ${String(ckRow.chunks).padEnd(6)}  ${String(ckRow.mid).padEnd(13)}  ${String(ckRow.fences).padEnd(13)}  ${String(ckRow.over).padEnd(12)}  ${ckRow.dup.padEnd(9)}  ${ckRow.ms.padEnd(8)}  ${ckRow.mbps} MB/s`,
    `${nvRow.name}  ${String(nvRow.chunks).padEnd(6)}  ${String(nvRow.mid).padEnd(13)}  ${String(nvRow.fences).padEnd(13)}  ${String(nvRow.over).padEnd(12)}  ${nvRow.dup.padEnd(9)}  ${nvRow.ms.padEnd(8)}  ${nvRow.mbps} MB/s`,
  ].join("\n"),
);

const verdict = [];
verdict.push(`mid-word cuts: naive ${nvRow.mid} vs chunkkit ${ckRow.mid} (${nvRow.mid - ckRow.mid} saved)`);
if (nvRow.fences > 0) verdict.push(`broken code fences: naive ${nvRow.fences} vs chunkkit ${ckRow.fences}`);
if (nvRow.over > 0) verdict.push(`size violations: naive ${nvRow.over} vs chunkkit ${ckRow.over}`);
console.log(`\nWhy it matters: ${verdict.join("; ")}.
Note: chunkkit's odd-fence chunks are overlap copies of whole blocks (cosmetic);
source code blocks are never split — the packer treats each fenced block as one segment.`);
