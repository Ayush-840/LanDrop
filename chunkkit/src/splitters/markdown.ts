import type { Segment } from "../types.js";
import { splitParagraphs } from "./paragraph.js";

const HEADING_RE = /^#{1,6}\s+.+$/;

/**
 * Split on markdown headings first (heading stays with its section), then
 * fall back to paragraph splitting *within* an oversized section (PRD F5).
 * Code fences (``` blocks) are never split inside.
 */
export function splitMarkdown(text: string, maxCharsHint = Infinity): Segment[] {
  const lines = text.split("\n");

  interface Raw { heading?: string; text: string; start: number }
  const sections: Raw[] = [];
  let curHeading: string | undefined;
  let curLines: string[] = [];
  let curStart = 0;
  let inFence = false;

  const flush = () => {
    if (!curLines.length) return;
    sections.push({ heading: curHeading, text: curLines.join("\n"), start: curStart });
    curLines = [];
  };

  let lineStart = 0;
  for (const ln of lines) {
    if (/^\s*```/.test(ln)) inFence = !inFence;
    if (!inFence && HEADING_RE.test(ln.trim())) {
      flush();
      curHeading = ln.trim();
      curStart = lineStart;
      curLines = [ln];
    } else {
      if (curLines.length === 0) curStart = lineStart;
      curLines.push(ln);
    }
    lineStart += ln.length + 1; // +1 for \n
  }
  flush();

  const out: Segment[] = [];
  for (const s of sections) {
    const l = s.text.length - s.text.replace(/^\s+/, "").length;
    const trimmedEnd = s.text.replace(/\s+$/, "").length;
    const body = s.text.slice(l, trimmedEnd);
    if (!body) continue;
    const base = s.start + l;
    if (body.length <= maxCharsHint) {
      out.push({ text: body, start: base, end: base + body.length, heading: s.heading });
    } else {
      // Fall back to paragraph split, carrying the heading through and
      // translating paragraph offsets (relative to body) into text coords.
      for (const p of splitParagraphs(body)) {
        out.push({
          text: p.text,
          start: base + p.start,
          end: base + p.end,
          heading: s.heading,
        });
      }
    }
  }
  return out;
}
