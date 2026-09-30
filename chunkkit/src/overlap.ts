import { takeTrailing } from "./counters.js";
import type { CounterFn } from "./types.js";

/**
 * Computes the overlap prefix for a chunk: the trailing `overlap` units of
 * the previous chunk's text. Returns "" when overlap is 0 or the previous
 * chunk is empty.
 */
export function overlapPrefix(
  prevText: string,
  overlap: number,
  count: CounterFn,
  unit: "chars" | "words",
): string {
  if (!overlap || !prevText) return "";
  void count; // reserved: custom-counter-aware overlap truncation
  return takeTrailing(prevText, overlap, count, unit);
}
