# chunkkit

**Structure-aware text chunking for RAG & LLM pipelines. Zero runtime dependencies.**

Naive fixed-length slicing cuts sentences and code blocks in half, hurting retrieval quality — and popular splitters pull in a large dependency tree for this one step. `chunkkit` just does chunking: markdown headings, paragraphs, sentences and code fences respected, configurable size + overlap in chars, words, or your own token counter.

Non-goals (v1): no embeddings, no vector DB, no LLM calls, no PDF/DOCX parsing.

```js
import { chunk } from "chunkkit";

const chunks = chunk(markdownText, {
  maxSize: 500,
  overlap: 50,
  unit: "chars",      // "chars" | "words" | (text) => number
  splitOn: "markdown", // "markdown" | "sentence" | "paragraph"
});
// → [{ text, start, end, index, heading? }]
```

## Install

```bash
npm install chunkkit
```

Requires Node ≥ 18. TypeScript types ship in the package (`.d.ts`), works from TS and plain JS.

## Quick start (2 min)

```js
import { chunk } from "chunkkit";

const chunks = chunk("First paragraph.\n\nSecond paragraph.", { maxSize: 40 });
console.log(chunks[0].text);
```

## API reference

### `chunk(text, options?) → Chunk[]`

| Option | Type | Default | Description |
|---|---|---|---|
| `maxSize` | `number` | `1000` | Max counted size per chunk. A single segment longer than `maxSize` is kept whole with `oversized: true`. |
| `overlap` | `number` | `0` | Trailing N units of chunk *i* repeated at the start of chunk *i+1*. Must be `< maxSize`. |
| `unit` | `"chars" \| "words" \| (s) => number` | `"chars"` | How size is measured. Pass your tokenizer's counter for token-accurate chunking. |
| `splitOn` | `"paragraph" \| "sentence" \| "markdown"` | `"paragraph"` | Splitting strategy. Markdown keeps headings with sections, falls back to paragraphs inside oversized sections, never splits inside ``` fences. |

`Chunk` shape: `{ text, index, start, end, heading?, oversized? }`. `start`/`end` are char offsets into the original input (pre-overlap). Pure function, deterministic, JSON-serializable.

### `estimateChunkCount(text, options?) → number`

Quick count without extra work (exact — delegates to `chunk().length`).

### `chunkStream(readable, options?) → AsyncGenerator<Chunk>`

Chunk a Node.js stream without holding extra copies:

```js
import { createReadStream } from "node:fs";
import { chunkStream } from "chunkkit";
for await (const c of chunkStream(createReadStream("notes.md"), { maxSize: 500 })) {
  console.log(c.index, c.text.slice(0, 60));
}
```

### `ChunkitError`

Thrown for invalid options (`overlap >= maxSize`, bad `unit`/`splitOn`, non-string input). Has `.code` (`"INVALID_OPTION"`).

## Examples

**Markdown RAG** (`examples/markdown-rag.mjs`): chunk study notes with `splitOn: "markdown"`, embed each `c.text`, store `{ index, start, end, heading }` alongside the vector.

**Custom token counter** (`examples/custom-counter.mjs`):

```js
// npm i tiktoken (not a chunkkit dependency)
import { get_encoding } from "tiktoken";
const enc = get_encoding("cl100k_base");
chunk(docs, { maxSize: 500, overlap: 50, unit: (s) => enc.encode(s).length });
```

**CLI** (should-have, ships in the package):

```bash
npx chunkkit notes.md --max-size 500 --overlap 50 --split-on markdown
npx chunkkit notes.md --max-size 500 --json
```

## Limitations

- Input is a text/markdown string — extract PDF/DOCX text first.
- Sentence splitting is regex-based (abbreviation-aware), not NLP-grade.
- v1 does not recursively split an oversized segment; it is kept whole with `oversized: true` (use `sentence` mode for finer granularity).
- Custom-counter overlap slicing falls back to chars for the overlap window.

## Contributing

```bash
npm install
npm test
npm run coverage
npm run build
```

PRs welcome — add a test for any behavior change.

## License

MIT
