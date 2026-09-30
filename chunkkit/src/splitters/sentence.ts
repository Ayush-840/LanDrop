import type { Segment } from "../types.js";
import { splitParagraphs } from "./paragraph.js";

const ABBREV = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e",
]);

/** Split one paragraph's text into sentence segments (heuristic, regex-based). */
function splitSentencesIn(text: string, base: number): Segment[] {
  const out: Segment[] = [];
  let start = 0;
  const n = text.length;
  let i = 0;
  const push = (s: number, e: number) => {
    const raw = text.slice(s, e);
    const t = raw.trim();
    if (!t) return;
    const l = raw.indexOf(t);
    out.push({ text: t, start: base + s + l, end: base + s + l + t.length });
  };
  while (i < n) {
    const c = text.charAt(i);
    if (c === "." || c === "!" || c === "?") {
      // Decimal guard: don't split between digits ("3.14").
      if (c === "." && /\d/.test(text.charAt(i - 1)) && /\d/.test(text.charAt(i + 1))) {
        i++;
        continue;
      }
      if (c === ".") {
        // Abbreviation guard ("Mr.", "e.g.").
        const w = text.slice(Math.max(0, i - 6), i).split(/\s+/).pop()?.toLowerCase().replace(/\.+$/, "");
        if (w && ABBREV.has(w)) {
          i++;
          continue;
        }
      }
      // Boundary if followed by whitespace + capital/end, or end of string.
      const rest = text.slice(i + 1);
      const mm = rest.match(/^\s*["'”’)\]]*\s*(?=[A-Z0-9“"'\n]|$)/);
      if (mm || i + 1 >= n) {
        // Avoid consuming the next sentence's first word: back up to whitespace end.
        let e = i + 1;
        // include closing quotes/brackets
        while (e < n && /["'”’)\]]/.test(text.charAt(e))) e++;
        push(start, e);
        // Skip whitespace to next sentence start.
        let ns = e;
        while (ns < n && /\s/.test(text.charAt(ns))) ns++;
        start = ns;
        i = ns;
        continue;
      }
    }
    i++;
  }
  if (start < n) push(start, n);
  return out;
}

/** Split paragraphs further on sentence boundaries. */
export function splitSentences(text: string): Segment[] {
  const out: Segment[] = [];
  for (const p of splitParagraphs(text)) {
    for (const s of splitSentencesIn(p.text, p.start)) out.push(s);
  }
  return out;
}
