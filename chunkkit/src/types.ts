/** Unit used to measure chunk sizes. */
export type CountUnit = "chars" | "words";

/** Strategy used to split text into atomic segments before packing. */
export type SplitStrategy = "paragraph" | "sentence" | "markdown";

/** A counter function measuring text size — plug in a tokenizer here. */
export type CounterFn = (s: string) => number;

/** @alias CountUnit */
export type Unit = CountUnit;

/** @alias SplitStrategy */
export type SplitOn = SplitStrategy;

/** Options for {@link chunk}. Everything is optional with sane defaults. */
export interface ChunkOptions {
  /** Maximum counted size of one chunk. Default 1000. */
  maxSize?: number;
  /** Trailing units of chunk *i* repeated at the start of chunk *i+1*. Default 0. */
  overlap?: number;
  /** Size unit: `"chars"`, `"words"`, or a custom `(text) => number` counter. Default `"chars"`. */
  unit?: CountUnit | CounterFn;
  /** Strategy used to find atomic segments. Default `"paragraph"`. */
  splitOn?: SplitStrategy;
}

/** One resulting chunk. Plain data, safe to JSON.stringify next to your embeddings. */
export interface Chunk {
  /** Chunk content (including overlap text when `overlap > 0`). */
  text: string;
  /** Zero-based position of this chunk in the result. */
  index: number;
  /** Offset of the chunk's first non-overlap character in the original input. */
  start: number;
  /** Offset just past the chunk's last character in the original input. */
  end: number;
  /** Enclosing markdown heading when `splitOn: "markdown"` (e.g. `"## Setup"`). */
  heading?: string;
  /** True when a single segment alone exceeded `maxSize` and was kept whole. */
  oversized?: boolean;
}

/** One atomic segment produced by a splitter. Internal. */
export interface Segment {
  text: string;
  /** Offset of segment start in the original input. */
  start: number;
  /** Offset just past the segment end in the original input. */
  end: number;
  /** Enclosing markdown heading (markdown strategy only). */
  heading?: string;
}
