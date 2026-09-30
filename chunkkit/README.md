# chunkkit

**Structure-aware text chunking for RAG and LLM pipelines. Zero dependencies.**

Anyone feeding documents to an LLM has to split text into chunks before embedding it. Naive fixed-length slicing cuts sentences and code blocks in half, which hurts retrieval quality — and every project re-implements ad hoc chunking by hand. `chunkkit` splits text into overlapping chunks while respecting structure (markdown headings, paragraphs, sentences, code fences) and staying under a configurable size limit measured in characters, words, or tokens (via a pluggable counter).

## Why it's useful

- **RAG pipelines & chatbots**: chunks that respect structure embed and retrieve better than arbitrary slices.
- **Context-window packing**: fit transcripts, logs or articles under an API limit without losing sentence boundaries.
- **Dependency-light**: zero runtime dependencies, dual ESM/CJS build, TypeScript types included — drop it into any Node.js 18+ project.

**Non-goals (v1):** no embedding generation, no vector storage, no LLM calls, no PDF/DOCX parsing (pass extracted text), no token-perfect counting for every tokenizer (plug in your own counter).

## Installation

```bash
npm install chunkkit
```

## Quick start

```js
import { chunk } from "chunkkit";

const chunks = chunk(markdownText, {
  maxSize: 500,
  overlap: 50,
  unit: "chars",        // "chars" | "words" | custom counter function
  splitOn: "markdown",  // "markdown" | "sentence" | "paragraph"
});
// chunks: [{ text, start, end, index, heading? }]
```

## API reference

### `chunk(text, options?) => Chunk[]`

| Option | Type | Default | Description |
|---|---|---|---|
| `text` | `string` | *(required)* | The input text (plain text or markdown). |
| `maxSize` | `number` | `1000` | Maximum counted size of one chunk. Never exceeded, except a single segment longer than `maxSize`, which is kept whole and flagged. |
| `overlap` | `number` | `0` | Trailing `overlap` units of chunk *i* repeated at the start of chunk *i+1*. Must be `< maxSize`. |
| `unit` | `"chars" \| "words" \| ((s: string) => number)` | `"chars"` | How chunk size is measured. Pass a tokenizer function (e.g. tiktoken) for token-accurate limits. |
| `splitOn` | `"paragraph" \| "sentence" \| "markdown"` | `"paragraph"` | Strategy used to find atomic segments. |

Each `Chunk` is plain data:

| Field | Type | Description |
|---|---|---|
| `text` | `string` | Chunk content (includes overlap text when `overlap > 0`). |
| `index` | `number` | Zero-based position in the result. |
| `start`, `end` | `number` | Offsets into the **original** input, so you can map a chunk back to its source location. |
| `heading?` | `string` | Enclosing markdown heading (markdown mode), e.g. `"## Setup"`. |
| `oversized?` | `boolean` | True when a single segment alone exceeded `maxSize` and was kept whole. |

### Other exports

| Export | Signature | Description |
|---|---|---|
| `estimateChunkCount` | `(text, options?) => number` | Quick count without building full chunk objects. |
| `chunkStream` | `(readable, options?) => AsyncGenerator<Chunk>` | Chunk a Node.js readable stream. |
| `chunkFile` | `(path, options?) => AsyncGenerator<Chunk>` | Chunk a file by path. |
| `ChunkitError` | `class extends Error` | The only error thrown. `code` is `"INVALID_OPTION"` or `"EMPTY_INPUT_UNIT"`. |

Input validation is eager: `chunk` throws a `ChunkitError` for `maxSize <= 0`, non-integer `maxSize`/`overlap`, negative `overlap`, `overlap >= maxSize`, unknown `unit`/`splitOn` values, or non-string input.

## Examples

**1. Plain chunking for embeddings** ([examples/basic.mjs](examples/basic.mjs)):

```js
import { chunk } from "chunkkit";

const text = `Beam is a peer-to-peer file transfer tool.
It runs on your local network.

Beam uses a custom reliable protocol called BTP.
BTP handles packet loss, reordering and corruption.`;

for (const c of chunk(text, { maxSize: 80, overlap: 20 })) {
  console.log(`[${c.start}-${c.end}] ${c.text}\n`);
}
```

**2. Markdown / RAG preprocessing** ([examples/markdown-rag.mjs](examples/markdown-rag.mjs)):

```js
import { chunk } from "chunkkit";
import { readFileSync } from "node:fs";

const doc = readFileSync("handbook.md", "utf8");
const chunks = chunk(doc, { maxSize: 500, overlap: 50, splitOn: "markdown" });

// Ready for embeddings: each chunk keeps its section heading.
const records = chunks.map((c) => ({
  section: c.heading ?? "(top)",
  text: c.text,
  location: [c.start, c.end],
}));
```

**3. Token-accurate chunking with a custom counter** ([examples/custom-counter.mjs](examples/custom-counter.mjs)):

```js
import { chunk } from "chunkkit";
import { getEncoding } from "tiktoken"; // your dependency, not ours

const enc = getEncoding("cl100k_base");
const chunks = chunk(longText, {
  maxSize: 512,
  overlap: 64,
  unit: (s) => enc.encode(s).length, // plug any tokenizer in here
});
```

**CLI:**

```bash
npx chunkkit notes.md --max-size 500 --overlap 50 --split-on markdown
npx chunkkit notes.md --json          # machine-readable chunk boundaries
```

## How it works

```
text ──▶ [splitOn strategy] ──▶ segments[] ──▶ [greedy pack to maxSize] ──▶ [apply overlap] ──▶ Chunk[]
```

1. **Split** into segments the packer will never cut in half (paragraphs, sentences, or heading-delimited markdown sections — code fences are never split).
2. **Greedy pack** segments into chunks while they fit under `maxSize`; a lone segment that exceeds it becomes its own `oversized` chunk (v1 does not recurse inside it — sentence mode already gives fine granularity there).
3. **Overlap** prepends the trailing `overlap` units of the previous chunk, trimmed so no chunk ever exceeds `maxSize`.
4. **Index** — `start`/`end` always refer to the original input string.

The function is pure and deterministic: same input + options, same chunks, always.

## Testing

```bash
npm test              # vitest
npm run coverage      # 100% statements, 95% branches, 100% functions
npm run lint          # eslint
npm run build         # dist/ with CJS + ESM + .d.ts
npm run bench         # chunkkit vs naive fixed-size slicing benchmark
```

### Benchmark: chunkkit vs naive fixed-size slicing

`npm run bench` tiles the test fixture into a markdown corpus (default 200 KB)
and compares structure-aware chunking against plain fixed-size windows on the
criteria that matter for RAG quality:

| Metric | Naive slicing | chunkkit (markdown) |
|---|---|---|
| Mid-word sentence cuts (120 KB corpus) | **218** | **0** |
| Code blocks cut in half | 79 odd-fence chunks | 0 source blocks split |
| Chunks over `maxSize` | 0 | 0 |
| Bytes spent on duplication | 10.0% | 1.0% |
| Throughput | ~2400 MB/s | ~40 MB/s |

Naive slicing is faster — it does nothing but `String.slice` — but it cuts
sentences mid-word and shreds code blocks. chunkkit spends a little time to
keep every paragraph, sentence and fenced block whole, and still processes a
120 KB document in ~3 ms.

## Limitations

- Input is plain text or a markdown **string** — no PDF/DOCX parsing; extract text first.
- Sentence splitting is regex-based (common abbreviations guarded), not NLP-grade.
- No recursive splitting inside an oversized single segment in v1 (flagged `oversized: true` instead).
- Node.js only in v1 (no browser bundle guarantee).

## Contributing

```bash
git clone <your-fork> && cd chunkkit
npm install
npm test          # add tests for behaviour changes
npm run lint      # keep the linter happy
```

Open a PR against `main`. Keep the public API stable under semver — breaking changes require a major version.

## License

[MIT](LICENSE)
