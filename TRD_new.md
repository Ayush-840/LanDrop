# TRD: chunkkit — Technical Design

Companion to `PRD.md`.

---

## 1. Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript | Types ship for free, catches API misuse at compile time, expected for a quality package |
| Build | `tsup` (esbuild-based) | One config, outputs CJS + ESM + `.d.ts` with minimal setup |
| Package manager | npm (or pnpm locally, npm for publish) | Assignment is "publish to NPM" |
| Test runner | Vitest | Fast, native TS, Jest-compatible API, easy coverage |
| Lint/format | ESLint + Prettier | Code quality is a grading criterion |
| CI | GitHub Actions | Test on push/PR, publish on tag |
| Versioning | semantic-release **or** manual semver + `npm version` | Either is fine; manual is simpler for a solo, time-boxed project — recommended |
| Docs | Single README.md + `examples/` folder + TypeDoc comments in source | README is graded directly; TypeDoc comments make the API self-documenting in editors |

Runtime dependencies: **none**. Dev dependencies only (`typescript`, `tsup`, `vitest`, `@vitest/coverage-v8`, `eslint`, `prettier`).

## 2. Package Layout

```
chunkkit/
├─ src/
│  ├─ index.ts            public exports
│  ├─ chunk.ts             chunk() — orchestrator
│  ├─ splitters/
│  │  ├─ paragraph.ts
│  │  ├─ sentence.ts
│  │  └─ markdown.ts
│  ├─ counters.ts          char/word counters, counter resolution
│  ├─ overlap.ts           overlap application
│  ├─ errors.ts            ChunkitError
│  ├─ stream.ts            chunkStream() (Should-have)
│  └─ types.ts             ChunkOptions, Chunk
├─ tests/
│  ├─ chunk.basic.test.ts
│  ├─ chunk.overlap.test.ts
│  ├─ chunk.markdown.test.ts
│  ├─ chunk.edgecases.test.ts
│  └─ fixtures/*.md
├─ examples/
│  ├─ basic.mjs
│  ├─ markdown-rag.mjs
│  └─ custom-counter.mjs
├─ bin/cli.ts               (Should-have CLI)
├─ .github/workflows/ci.yml
├─ package.json
├─ tsconfig.json
├─ tsup.config.ts
├─ CHANGELOG.md
├─ LICENSE
└─ README.md
```

## 3. Core Algorithm

### 3.1 Pipeline

```
text ──▶ [splitOn strategy] ──▶ segments[] ──▶ [greedy pack to maxSize] ──▶ [apply overlap] ──▶ Chunk[]
```

1. **Split into segments.** The chosen strategy (`paragraph`, `sentence`, or `markdown`) breaks the raw text into an ordered list of `{ text, start, end, heading? }` segments — units that should never be split apart if avoidable (a paragraph, a sentence, a markdown section).
2. **Greedy packing.** Walk the segments, accumulating them into the current chunk while `counter(current + segment) <= maxSize`. When adding the next segment would exceed `maxSize`, close the current chunk and start a new one. If a single segment alone exceeds `maxSize`, it becomes its own chunk marked `oversized: true` (v1 does not recursively split inside a segment — documented limitation; sentence-mode already gives fine granularity for this case).
3. **Overlap.** For chunk *i+1*, prepend the trailing `overlap` units (by the same counter) of chunk *i*'s text, recomputing `start` accordingly. Overlap is skipped for the first chunk and capped so it never exceeds `maxSize / 2` (validated in F6).
4. **Indexing.** Each result gets a zero-based `index`, and `start`/`end` are offsets into the *original* input string (pre-overlap), so callers can map a chunk back to its source location.

### 3.2 Splitters

- **paragraph:** split on `/\n\s*\n/`, trim, drop empty segments.
- **sentence:** split paragraphs further on a sentence boundary regex (`. `, `! `, `? ` not preceded by a common abbreviation list); simple and documented as heuristic, not NLP-grade.
- **markdown:** split on heading lines (`/^#{1,6}\s+.+$/m`) first, so each segment is "one section, heading included"; within a section, if it exceeds `maxSize`, fall back to the paragraph splitter recursively, carrying the heading through.

### 3.3 Counters

```ts
type Counter = (s: string) => number;
const counters: Record<"chars" | "words", Counter> = {
  chars: (s) => s.length,
  words: (s) => (s.trim() ? s.trim().split(/\s+/).length : 0),
};
function resolveCounter(unit: ChunkOptions["unit"]): Counter {
  if (typeof unit === "function") return unit;
  return counters[unit ?? "chars"];
}
```
This is how a caller plugs in a real tokenizer (e.g. `tiktoken`) without chunkkit depending on it — documented in the README with a copy-pasteable example.

### 3.4 Errors

```ts
export class ChunkitError extends Error {
  constructor(message: string, public code: "INVALID_OPTION" | "EMPTY_INPUT_UNIT") {
    super(message);
    this.name = "ChunkitError";
  }
}
```
Validated eagerly at the top of `chunk()`: `maxSize > 0`, `overlap >= 0 && overlap < maxSize`, `unit` is a known string or a function.

## 4. Public API

```ts
// types.ts
export interface ChunkOptions {
  maxSize?: number;                                  // default 1000
  overlap?: number;                                  // default 0
  unit?: "chars" | "words" | ((s: string) => number); // default "chars"
  splitOn?: "paragraph" | "sentence" | "markdown";    // default "paragraph"
}

export interface Chunk {
  text: string;
  index: number;
  start: number;
  end: number;
  heading?: string;
  oversized?: boolean;
}

// index.ts
export function chunk(text: string, options?: ChunkOptions): Chunk[];
export function estimateChunkCount(text: string, options?: ChunkOptions): number;
export function chunkStream(
  input: NodeJS.ReadableStream,
  options?: ChunkOptions
): AsyncGenerator<Chunk>;
export class ChunkitError extends Error {}
export type { ChunkOptions, Chunk };
```

Design choices worth noting in the README (API design is graded):
- One required argument (`text`), everything else optional with sane defaults — usable as `chunk(text)`.
- Returns plain data (no class instances), so results are trivially `JSON.stringify`-able for storing alongside embeddings.
- Pure function, no hidden state, no global config — safe to call concurrently.

## 5. Testing Plan

| File | Covers |
|---|---|
| `chunk.basic.test.ts` | default options, `maxSize` never exceeded, deterministic output, chars vs words counting |
| `chunk.overlap.test.ts` | overlap content is exactly the trailing N units of the previous chunk; overlap 0 behaves like no overlap; invalid overlap throws |
| `chunk.markdown.test.ts` | headings preserved and attached; nested fallback to paragraph when a section is too big |
| `chunk.edgecases.test.ts` | empty string → `[]`; whitespace-only; single char; text shorter than `maxSize` → one chunk; a single word longer than `maxSize` → `oversized: true` |
| `errors.test.ts` | every `ChunkitError` case throws with the right `code` |
| `stream.test.ts` (if S1 built) | chunkStream on a fs.ReadStream reproduces `chunk()` output for the same file read whole |

Coverage target: **≥ 90%** statements/branches on `src/`, enforced by `vitest --coverage` in CI (fail build under threshold).

```bash
npm test              # vitest run
npm run test:watch    # vitest
npm run coverage      # vitest run --coverage
```

## 6. package.json (key fields)

```json
{
  "name": "chunkkit",
  "version": "1.0.0",
  "description": "Structure-aware text chunking for RAG and LLM pipelines. Zero dependencies.",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "bin": { "chunkkit": "./dist/cli.js" },
  "files": ["dist", "README.md", "LICENSE"],
  "keywords": ["rag", "llm", "text-splitting", "chunking", "embeddings", "nlp"],
  "engines": { "node": ">=18" },
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/<user>/chunkkit.git" },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "coverage": "vitest run --coverage",
    "lint": "eslint src tests",
    "prepublishOnly": "npm run lint && npm test && npm run build"
  }
}
```
`prepublishOnly` is the safety net: `npm publish` cannot ship broken or untested code.

## 7. Versioning Plan (SemVer)

| Version | Meaning | Example trigger |
|---|---|---|
| `0.x.y` (optional pre-release phase) | API may still change | early testing via `npm publish --tag next` |
| `1.0.0` | First stable public API | M4, matches PRD "Must have" scope |
| `1.x.0` (minor) | New backward-compatible feature | adding `chunkStream`, new `splitOn` mode |
| `1.x.y` (patch) | Bug fix, no API change | overlap edge-case fix |
| `2.0.0` (major) | Breaking API change | renaming an option, changing return shape |

Process: `npm version patch|minor|major` (updates `package.json`, creates a git tag) → push tag → CI publish workflow runs `npm publish` → create a matching GitHub Release with `CHANGELOG.md` notes.

## 8. CI/CD

`.github/workflows/ci.yml`
- On every push/PR: `npm ci`, `npm run lint`, `npm test -- --coverage`.

`.github/workflows/publish.yml`
- On push of a tag `v*`: `npm ci`, `npm run build`, `npm test`, `npm publish --provenance --access public` using an `NPM_TOKEN` repo secret.

## 9. Documentation Plan (maps to the assignment's README rubric)

| README section | Content |
|---|---|
| What it does | One-paragraph pitch + the code sample from PRD §2 |
| Why it's useful | The problem (PRD §1), who it's for |
| Installation | `npm install chunkkit` |
| Quick start | 5-line example, default options |
| API reference | Table of `chunk()` params with types/defaults, `Chunk` shape, `ChunkitError` codes |
| Examples | Plain chunking, markdown/RAG use case, custom token counter (tiktoken) |
| Limitations | No PDF parsing, sentence splitting is regex-based not NLP, no recursive oversized-segment splitting in v1 |
| Contributing | How to run tests locally, how to open a PR, code of conduct link (optional) |
| License | MIT |

## 10. Definition of Done (engineering checklist)

- [ ] `npm run build` produces `dist/` with CJS, ESM and types
- [ ] `npm test` and `npm run coverage` pass locally and in CI, ≥ 90%
- [ ] `npm pack` inspected — only `dist/`, README, LICENSE included (no `src/`, no tests)
- [ ] `npm publish --access public` succeeds; `npm install chunkkit` works in a throwaway project
- [ ] GitHub repo has topics/description set, README renders correctly on GitHub, LICENSE file present
- [ ] Tag `v1.0.0` and GitHub Release created with notes
