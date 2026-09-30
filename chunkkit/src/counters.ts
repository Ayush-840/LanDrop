import type { CountUnit, ChunkOptions, CounterFn } from "./types.js";

/** Built-in counters. */
export const counters: Record<CountUnit, CounterFn> = {
  chars: (s) => s.length,
  words: (s) => (s.trim() ? s.trim().split(/\s+/).length : 0),
};

/**
 * Resolves the `unit` option to a counter function. Accepts the built-in
 * unit names or any `(text) => number` function, which is how callers plug
 * in a real tokenizer (e.g. tiktoken) without chunkkit depending on it.
 */
export function resolveCounter(unit: ChunkOptions["unit"]): CounterFn {
  if (typeof unit === "function") return unit;
  if (unit === "words") return counters.words;
  if (unit === "chars" || unit === undefined) return counters.chars;
  throw new TypeError(
    `chunkkit: invalid unit ${JSON.stringify(unit)} — expected "chars", "words" or a (text) => number function`,
  );
}

/**
 * Returns the trailing `n` units of `text` — the overlap prefix for the
 * next chunk. `unit` selects character or word units (custom counters
 * overlap by characters).
 */
export function takeTrailing(text: string, n: number, count: CounterFn, unit: "chars" | "words"): string {
  if (n <= 0 || !text) return "";
  if (unit === "words") {
    const words = text.trim().split(/\s+/);
    return words.slice(Math.max(0, words.length - n)).join(" ");
  }
  return text.slice(Math.max(0, text.length - n));
}

/** Counts units of `s` in the given named unit (used by overlap sizing). */
export function countUnits(s: string, unit: "chars" | "words"): number {
  return (unit === "words" ? counters.words : counters.chars)(s);
}
