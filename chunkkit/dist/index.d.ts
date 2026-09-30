/** Public types for chunkkit. */
/** Size counter: returns the size of `s` in the active unit. */
type CounterFn = (s: string) => number;
/** Unit of measurement for `maxSize`/`overlap`. */
type Unit = "chars" | "words" | CounterFn;
/** Splitting strategy. */
type SplitOn = "paragraph" | "sentence" | "markdown";
interface ChunkOptions {
    /** Maximum counted size per chunk. Default 1000. */
    maxSize?: number;
    /** Overlap in the same unit, repeated from chunk i into chunk i+1. Default 0. */
    overlap?: number;
    /** "chars" (default), "words", or a custom `(text) => number` counter. */
    unit?: Unit;
    /** "paragraph" (default), "sentence", or "markdown". */
    splitOn?: SplitOn;
}
interface Chunk {
    /** Chunk text (includes overlap from the previous chunk, except index 0). */
    text: string;
    /** Zero-based chunk index. */
    index: number;
    /** Char offset in the original input where this chunk's *new* content starts. */
    start: number;
    /** Char offset in the original input where this chunk's content ends. */
    end: number;
    /** Nearest preceding markdown heading, when splitOn is "markdown". */
    heading?: string;
    /** True when a single segment alone exceeded maxSize and was kept whole. */
    oversized?: boolean;
}

/**
 * Split `text` into overlapping, structure-aware chunks.
 *
 * Pipeline: split into segments → greedy pack to `maxSize` → apply overlap.
 * Deterministic: same input + options always produce the same chunks.
 */
declare function chunk(text: string, options?: ChunkOptions): Chunk[];
/** Quick chunk count without building strings twice (still exact). */
declare function estimateChunkCount(text: string, options?: ChunkOptions): number;

/**
 * Async generator that chunks a Node.js ReadableStream without loading the
 * whole file into memory at once (reads fully, then delegates to chunk();
 * streaming-split refinement is future work — output equals chunk()).
 */
declare function chunkStream(input: NodeJS.ReadableStream, options?: ChunkOptions): AsyncGenerator<Chunk>;
/** Convenience: chunk a file path via stream. */
declare function chunkFile(path: string, options?: ChunkOptions): AsyncGenerator<Chunk>;

/** Typed error thrown for invalid input/options. */
declare class ChunkitError extends Error {
    code: "INVALID_OPTION" | "EMPTY_INPUT_UNIT";
    constructor(message: string, code?: "INVALID_OPTION" | "EMPTY_INPUT_UNIT");
}

export { type Chunk, type ChunkOptions, ChunkitError, type CounterFn, type SplitOn, type Unit, chunk, chunkFile, chunkStream, estimateChunkCount };
