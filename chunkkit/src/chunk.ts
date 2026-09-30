import { resolveCounter } from "./counters.js";
import { ChunkitError } from "./errors.js";
import { overlapPrefix } from "./overlap.js";
import { splitMarkdown } from "./splitters/markdown.js";
import { splitParagraphs } from "./splitters/paragraph.js";
import { splitSentences } from "./splitters/sentence.js";
import type { Chunk, ChunkOptions, Segment } from "./types.js";

const DEFAULTS = { maxSize: 1000, overlap: 0, splitOn: "paragraph" } as const;

function validate(text: unknown, o: ChunkOptions): void {
  if (typeof text !== "string") throw new ChunkitError("text must be a string", "INVALID_OPTION");
  const maxSize = o.maxSize ?? DEFAULTS.maxSize;
  const overlap = o.overlap ?? DEFAULTS.overlap;
  if (!Number.isFinite(maxSize) || maxSize <= 0 || !Number.isInteger(maxSize))
    throw new ChunkitError("maxSize must be a positive integer", "INVALID_OPTION");
  if (!Number.isInteger(overlap) || overlap < 0)
    throw new ChunkitError("overlap must be a non-negative integer", "INVALID_OPTION");
  if (overlap >= maxSize)
    throw new ChunkitError(`overlap (${overlap}) must be < maxSize (${maxSize})`, "INVALID_OPTION");
  const unit = o.unit ?? "chars";
  if (typeof unit !== "function" && unit !== "chars" && unit !== "words")
    throw new ChunkitError(`unit must be "chars", "words" or a counter function`, "INVALID_OPTION");
  const splitOn = o.splitOn ?? DEFAULTS.splitOn;
  if (splitOn !== "paragraph" && splitOn !== "sentence" && splitOn !== "markdown")
    throw new ChunkitError(`splitOn must be "paragraph", "sentence" or "markdown"`, "INVALID_OPTION");
}

function splitter(text: string, splitOn: string, maxSize: number): Segment[] {
  if (splitOn === "sentence") return splitSentences(text);
  if (splitOn === "markdown") return splitMarkdown(text, maxSize);
  return splitParagraphs(text);
}

/**
 * Split `text` into overlapping, structure-aware chunks.
 *
 * Pipeline: split into segments → greedy pack to `maxSize` → apply overlap.
 * Deterministic: same input + options always produce the same chunks.
 */
export function chunk(text: string, options: ChunkOptions = {}): Chunk[] {
  validate(text, options);
  const maxSize = options.maxSize ?? DEFAULTS.maxSize;
  const overlap = options.overlap ?? DEFAULTS.overlap;
  const unit = options.unit ?? "chars";
  const splitOn = options.splitOn ?? DEFAULTS.splitOn;
  const count = resolveCounter(unit);
  const unitName = typeof unit === "function" ? "custom" : unit;

  if (text === "" || count(text) === 0) {
    // Empty string → []; whitespace-only → [] (nothing to chunk).
    if (text === "") return [];
    // Whitespace-only: no segments; return [] per F8.
    const segs = splitter(text, splitOn, maxSize);
    if (segs.length === 0) return [];
  }

  const segments = splitter(text, splitOn, maxSize);
  if (segments.length === 0) return [];

  interface Packed { segs: Segment[]; size: number; text: string; start: number; end: number; heading?: string; oversized: boolean }
  const packed: Packed[] = [];
  let cur: Packed | null = null;

  const joinText = (parts: string[]) => parts.join("\n\n");

  for (const s of segments) {
    const sSize = count(s.text);
    if (sSize > maxSize) {
      // Single segment exceeds maxSize: close current, keep whole + flag.
      if (cur && cur.segs.length) packed.push(cur);
      cur = null;
      packed.push({ segs: [s], size: sSize, text: s.text, start: s.start, end: s.end, heading: s.heading, oversized: true });
      continue;
    }
    if (!cur) {
      cur = { segs: [s], size: sSize, text: s.text, start: s.start, end: s.end, heading: s.heading, oversized: false };
      continue;
    }
    const candidate = joinText([...cur.segs.map((x) => x.text), s.text]);
    if (count(candidate) <= maxSize) {
      cur.segs.push(s);
      cur.text = candidate;
      cur.size = count(candidate);
      cur.end = s.end;
      if (!cur.heading && s.heading) cur.heading = s.heading;
    } else {
      packed.push(cur);
      cur = { segs: [s], size: sSize, text: s.text, start: s.start, end: s.end, heading: s.heading, oversized: false };
    }
  }
  if (cur && cur.segs.length) packed.push(cur);

  // Apply overlap: chunk i+1 gets trailing `overlap` units of packed[i].text.
  const out: Chunk[] = packed.map((p, i) => {
    let prefix = "";
    if (i > 0 && overlap > 0) {
      const prevRaw = packed[i - 1]?.text ?? "";
      prefix = overlapPrefix(prevRaw, overlap, count, unitName === "custom" ? "chars" : unitName);
      // Cap overlap so chunk never exceeds maxSize: trim prefix if needed.
      if (prefix) {
        let candidate = prefix + "\n\n" + p.text;
        while (candidate && count(candidate) > maxSize) {
          // Shrink prefix from the front (chars) or drop words.
          if (unitName === "words") {
            const w = prefix.trim().split(/\s+/);
            w.shift();
            prefix = w.join(" ");
          } else {
            prefix = prefix.slice(1);
          }
          if (!prefix) break;
          candidate = prefix + "\n\n" + p.text;
        }
      }
    }
    const fullText = prefix ? prefix + "\n\n" + p.text : p.text;
    const c: Chunk = { text: fullText, index: i, start: p.start, end: p.end };
    if (p.heading) c.heading = p.heading;
    if (p.oversized) c.oversized = true;
    return c;
  });

  return out;
}

/** Quick chunk count without building strings twice (still exact). */
export function estimateChunkCount(text: string, options: ChunkOptions = {}): number {
  return chunk(text, options).length;
}
