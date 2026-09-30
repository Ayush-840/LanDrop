# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-09-30

> Published as **`@ayush-840/chunkkit`** — the unscoped name `chunkkit` is
> blocked by npm's typosquatting protection (too similar to `chunk-kit`).

### Added

- `chunk(text, options)` — structure-aware splitting with `maxSize`, `overlap`,
  `unit` (`"chars"`, `"words"`, or a custom counter) and `splitOn`
  (`"paragraph"`, `"sentence"`, `"markdown"`).
- `estimateChunkCount(text, options)` — quick count.
- `chunkStream(readable, options)` / `chunkFile(path, options)` — async
  generators for stream-based chunking.
- `ChunkitError` with machine-readable `code` (`INVALID_OPTION`,
  `EMPTY_INPUT_UNIT`).
- Markdown mode: heading metadata on chunks, oversized-section fallback to
  paragraphs, code fences never split.
- CLI: `npx chunkkit file.md --max-size 500 --overlap 50 --json`.
- 100% statement / 93% branch / 100% function test coverage (vitest + v8).
