# PRD: chunkkit — Structure-Aware Text Chunking for RAG & LLM Pipelines

**Activity:** Publish an NPM Package (individual)
**Due (tentative):** 18 November
**Package name (npm):** `chunkkit` (check availability; fallback `@yourusername/chunkkit`)

---

## 1. Problem

Anyone building a RAG pipeline or feeding documents to an LLM has to split text into chunks before embedding it. Doing this well is a repeated, fiddly problem:

- Naive fixed-length slicing cuts sentences and code blocks in half, which hurts retrieval quality.
- Popular solutions (LangChain's splitters) pull in a large dependency tree just for this one step, and are hard to use from a plain Node.js script.
- Every project re-implements ad hoc chunking: split by paragraph, then trim, then overlap, then re-check token limits, by hand, again.

This is a real gap the author has hit personally while building retrieval and knowledge-base projects: there is no small, dependency-light, well-tested npm package that just does structure-aware chunking with configurable size and overlap.

## 2. Solution

`chunkkit` is a **zero-runtime-dependency** TypeScript/JavaScript library that splits text into overlapping chunks while respecting structure — markdown headings, paragraphs, sentences and code fences — and staying under a configurable size limit measured in characters, words, or tokens (via a pluggable counter, so it works with or without a tokenizer library).

```js
import { chunk } from "chunkkit";

const chunks = chunk(markdownText, {
  maxSize: 500,
  overlap: 50,
  unit: "chars",       // "chars" | "words" | custom counter function
  splitOn: "markdown",  // "markdown" | "sentence" | "paragraph"
});
// chunks: [{ text, start, end, index, heading? }]
```

## 3. Target Users

- Developers building RAG pipelines, chatbots or search over documents in Node.js/TypeScript.
- Anyone preprocessing long text (transcripts, logs, articles) for an LLM API with a context limit.
- The author's own current and future projects (a genuine, not fabricated, use case).

## 4. Goals

| Goal | Success measure |
|---|---|
| Solve a real, well-defined problem | README states the problem and non-goals in the first paragraph |
| Small and dependency-free | Zero runtime dependencies; install size < 20 KB |
| Good API design | One main function usable in one line; advanced options are optional, not required |
| Correct, tested behaviour | ≥ 90% statement coverage; no chunk ever exceeds `maxSize`; overlap is exact |
| Real publication | Version `1.0.0` live on npm, installable with `npm install chunkkit` |
| Good documentation | A new user can go from `npm install` to working code in under 2 minutes using only the README |

## 5. Non-Goals (v1)

- No embedding generation, no vector storage, no LLM calls — chunking only.
- No PDF/DOCX parsing — input is plain text or markdown string; the caller extracts text first.
- No token-perfect counting for every tokenizer — a pluggable counter function covers that, the package ships a simple built-in word/char counter only.
- No browser bundle guarantee in v1 (Node.js only; ESM+CJS dual build is a stretch goal, not required).

## 6. Functional Requirements

### Must have

| ID | Requirement |
|---|---|
| F1 | `chunk(text, options)` splits text into an array of chunk objects `{ text, index, start, end }` |
| F2 | `maxSize` option bounds every chunk; no chunk's counted size exceeds it (except a single token/word longer than `maxSize` itself, which is kept whole and flagged `oversized: true`) |
| F3 | `overlap` option repeats the trailing N units of chunk *i* at the start of chunk *i+1* |
| F4 | `unit` option: `"chars"` (default), `"words"`, or a custom `(text) => number` counter |
| F5 | `splitOn` option: `"paragraph"` (default), `"sentence"`, `"markdown"` (splits on headings first, keeping heading with its section, then falls back to paragraph/sentence within an oversized section) |
| F6 | Input validation: throws a typed `ChunkitError` with a clear message for invalid options (e.g. `overlap >= maxSize`) |
| F7 | Deterministic output: same input + options always produce the same chunks |
| F8 | Works on empty string (`[]`), whitespace-only input, and single-character input |
| F9 | TypeScript types shipped (`.d.ts`), works from both TS and plain JS |

### Should have

| ID | Requirement |
|---|---|
| S1 | `chunkStream(readable, options)` — async generator for chunking a Node.js stream without loading the whole file into memory |
| S2 | `estimateChunkCount(text, options)` — quick count without building full chunk objects |
| S3 | Markdown heading metadata attached to each chunk (`heading: "## Setup"`) |
| S4 | CLI (`npx chunkkit file.md --max-size 500`) printing chunk boundaries — nice for the demo, optional for grading |

### Stretch

| ID | Requirement |
|---|---|
| X1 | Dual ESM + CJS build via `tsup`, with correct `exports` map |
| X2 | Code-fence-aware splitting (never splits inside a ``` block) |
| X3 | Pluggable tokenizer adapter example for `tiktoken` in docs (not a dependency) |

## 7. API Sketch (see TRD for full design)

```ts
export interface ChunkOptions {
  maxSize?: number;              // default 1000
  overlap?: number;              // default 0
  unit?: "chars" | "words" | ((s: string) => number);
  splitOn?: "paragraph" | "sentence" | "markdown";
}

export interface Chunk {
  text: string;
  index: number;
  start: number;   // char offset in original text
  end: number;
  heading?: string;
  oversized?: boolean;
}

export function chunk(text: string, options?: ChunkOptions): Chunk[];
export class ChunkitError extends Error {}
```

## 8. Success Criteria / Definition of Done

- [ ] Published on npm as `chunkkit@1.0.0` (or scoped fallback), installable and importable
- [ ] Public GitHub repo with README, LICENSE, CI badge
- [ ] `npm test` passes with ≥ 90% coverage
- [ ] README covers: what/why, install, quick start, full API table, 3+ examples, limitations, contributing
- [ ] Semantic versioning followed from the first release; CHANGELOG started
- [ ] At least one real usage example against the author's own project (e.g. chunking notes for a RAG pipeline), shown in the README or a linked example file

## 9. Milestones (mapped to the activity's 4 milestones)

| Milestone | Target | Deliverable |
|---|---|---|
| M1 — Idea & problem definition | Week 1 | This PRD + short problem statement in README draft |
| M2 — Initial implementation | Week 2 | `chunk()` working for chars/words + paragraph/sentence split, basic tests passing locally |
| M3 — Testing & documentation | Week 3 | ≥ 90% coverage, markdown split mode, full README, examples folder |
| M4 — NPM publication | Week 4 (before 18 Nov) | `v1.0.0` published, GitHub release tagged, repo polished |

## 10. Risks

| Risk | Mitigation |
|---|---|
| Name `chunkkit` taken on npm | Check early (M1); fallback to scoped `@username/chunkkit` or alternate name |
| Overlap/oversized edge cases are fiddly | Write these test cases first (TDD) before wiring up the CLI/stretch features |
| Running out of time before publish | Freeze scope to "Must have" (F1–F9) by end of Week 2; Should/Stretch only if ahead of schedule |
| Forgetting to actually publish | Put `npm publish --access public` as an explicit M4 checklist item, not implied by "code is done" |
