import type { Segment } from "../types.js";

/** Split on blank lines, trim, drop empties. Tracks char offsets. */
export function splitParagraphs(text: string): Segment[] {
  const segs: Segment[] = [];
  const re = /\n\s*\n/g;
  let start = 0;
  let m: RegExpExecArray | null;
  const push = (raw: string, s: number, e: number) => {
    // Trim but keep offsets aligned to the trimmed slice.
    const l = raw.length - raw.replace(/^\s+/, "").length;
    const trimmedEnd = raw.replace(/\s+$/, "").length;
    const t = raw.slice(l, trimmedEnd);
    if (!t) return;
    segs.push({ text: t, start: s + l, end: s + trimmedEnd });
  };
  while ((m = re.exec(text)) !== null) {
    push(text.slice(start, m.index), start, m.index);
    start = m.index + m[0].length;
  }
  push(text.slice(start), start, text.length);
  return segs;
}
