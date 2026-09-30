#!/usr/bin/env node
"use strict";

// bin/cli.ts
var import_node_fs2 = require("fs");

// src/counters.ts
var charCounter = (s) => s.length;
var wordCounter = (s) => {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
};
function resolveCounter(unit2) {
  if (typeof unit2 === "function") return unit2;
  if (unit2 === void 0 || unit2 === "chars") return charCounter;
  if (unit2 === "words") return wordCounter;
  return charCounter;
}
function takeTrailing(s, n, count, unit2) {
  if (n <= 0 || !s) return "";
  if (unit2 === "words") {
    const parts = s.split(/(\s+)/);
    let words = 0;
    let i = parts.length - 1;
    for (; i >= 0; i--) {
      const tok = parts[i];
      if (/^\s+$/.test(tok) || tok === "") continue;
      if (words + 1 > n) break;
      words += 1;
    }
    let start = 0;
    let seen = 0;
    const slice = parts.slice(Math.max(0, i + 1)).join("");
    return slice.replace(/^\s+/, "");
  }
  return s.slice(Math.max(0, s.length - n));
}

// src/errors.ts
var ChunkitError = class extends Error {
  code;
  constructor(message, code = "INVALID_OPTION") {
    super(message);
    this.name = "ChunkitError";
    this.code = code;
  }
};

// src/overlap.ts
function overlapPrefix(prevText, overlap2, count, unit2) {
  if (!overlap2 || !prevText) return "";
  return takeTrailing(prevText, overlap2, count, unit2);
}

// src/splitters/paragraph.ts
function splitParagraphs(text2) {
  const segs = [];
  const re = /\n\s*\n/g;
  let start = 0;
  let m;
  const push = (raw, s, e) => {
    const l = raw.length - raw.replace(/^\s+/, "").length;
    const trimmedEnd = raw.replace(/\s+$/, "").length;
    const t = raw.slice(l, trimmedEnd);
    if (!t) return;
    segs.push({ text: t, start: s + l, end: s + trimmedEnd });
  };
  while ((m = re.exec(text2)) !== null) {
    push(text2.slice(start, m.index), start, m.index);
    start = m.index + m[0].length;
  }
  push(text2.slice(start), start, text2.length);
  return segs;
}

// src/splitters/markdown.ts
var HEADING_RE = /^#{1,6}\s+.+$/;
function splitMarkdown(text2, maxCharsHint = Infinity) {
  const lines = text2.split("\n");
  const offsets = [];
  let pos = 0;
  for (const ln of lines) {
    offsets.push(pos);
    pos += ln.length + 1;
  }
  const sections = [];
  let curHeading;
  let curLines = [];
  let curStart = 0;
  let inFence = false;
  const flush = (endLine) => {
    if (!curLines.length) return;
    const end = endLine <= 0 ? text2.length : offsets[endLine];
    const raw = curLines.join("\n");
    sections.push({ heading: curHeading, text: raw, start: curStart, end });
    curLines = [];
  };
  curStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\s*```/.test(ln)) inFence = !inFence;
    if (!inFence && HEADING_RE.test(ln.trim())) {
      flush(i);
      curHeading = ln.trim();
      curStart = offsets[i];
      curLines = [ln];
    } else {
      if (curLines.length === 0) curStart = offsets[i];
      curLines.push(ln);
    }
  }
  flush(lines.length);
  const out = [];
  for (const s of sections) {
    const trimmed = s.text.replace(/^\s+|\s+$/g, "");
    if (!trimmed) continue;
    const l = s.text.length - s.text.replace(/^\s+/, "").length;
    const trimmedEnd = s.text.replace(/\s+$/, "").length;
    const base = s.start + l;
    const body = s.text.slice(l, trimmedEnd);
    if (body.length <= maxCharsHint) {
      out.push({ text: body, start: base, end: base + body.length, heading: s.heading });
    } else {
      for (const p of splitParagraphs(body)) {
        out.push({
          text: p.text,
          start: base + (p.start - 0),
          end: base + (p.end - 0),
          heading: s.heading
        });
      }
    }
  }
  return out.filter((s) => s.text.length > 0);
}

// src/splitters/sentence.ts
var ABBREV = /* @__PURE__ */ new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "sr",
  "jr",
  "st",
  "vs",
  "etc",
  "e.g",
  "i.e"
]);
function splitSentencesIn(text2, base) {
  const out = [];
  let start = 0;
  const n = text2.length;
  let i = 0;
  const push = (s, e) => {
    const t = text2.slice(s, e).trim();
    if (!t) return;
    const l = text2.slice(s, e).indexOf(t);
    out.push({ text: t, start: base + s + l, end: base + s + l + t.length });
  };
  while (i < n) {
    const c = text2[i];
    if (c === "." || c === "!" || c === "?") {
      if (c === ".") {
        const w = text2.slice(Math.max(0, i - 6), i).split(/\s+/).pop()?.toLowerCase().replace(/\.+$/, "");
        if (w && ABBREV.has(w)) {
          i++;
          continue;
        }
      }
      const rest = text2.slice(i + 1);
      const mm = rest.match(/^\s*(["'”’)\]]*\s*)(?=[A-Z0-9“"'\n]|$)/);
      if (mm || i + 1 >= n) {
        const end = mm ? i + 1 + mm[0].length : n;
        let e = i + 1;
        while (e < n && /["'”’)\]]/.test(text2[e])) e++;
        push(start, e);
        let ns = e;
        while (ns < n && /\s/.test(text2[ns])) ns++;
        start = ns;
        i = ns;
        continue;
      }
    }
    i++;
  }
  if (start < n) push(start, n);
  return out.length ? out : [{ text: text2.trim(), start: base, end: base + text2.length }];
}
function splitSentences(text2) {
  const out = [];
  for (const p of splitParagraphs(text2)) {
    for (const s of splitSentencesIn(p.text, p.start)) out.push(s);
  }
  return out;
}

// src/chunk.ts
var DEFAULTS = { maxSize: 1e3, overlap: 0, splitOn: "paragraph" };
function validate(text2, o) {
  if (typeof text2 !== "string") throw new ChunkitError("text must be a string", "INVALID_OPTION");
  const maxSize2 = o.maxSize ?? DEFAULTS.maxSize;
  const overlap2 = o.overlap ?? DEFAULTS.overlap;
  if (!Number.isFinite(maxSize2) || maxSize2 <= 0 || !Number.isInteger(maxSize2))
    throw new ChunkitError("maxSize must be a positive integer", "INVALID_OPTION");
  if (!Number.isInteger(overlap2) || overlap2 < 0)
    throw new ChunkitError("overlap must be a non-negative integer", "INVALID_OPTION");
  if (overlap2 >= maxSize2)
    throw new ChunkitError(`overlap (${overlap2}) must be < maxSize (${maxSize2})`, "INVALID_OPTION");
  const unit2 = o.unit ?? "chars";
  if (typeof unit2 !== "function" && unit2 !== "chars" && unit2 !== "words")
    throw new ChunkitError(`unit must be "chars", "words" or a counter function`, "INVALID_OPTION");
  const splitOn2 = o.splitOn ?? DEFAULTS.splitOn;
  if (splitOn2 !== "paragraph" && splitOn2 !== "sentence" && splitOn2 !== "markdown")
    throw new ChunkitError(`splitOn must be "paragraph", "sentence" or "markdown"`, "INVALID_OPTION");
}
function splitter(text2, splitOn2, maxSize2) {
  if (splitOn2 === "sentence") return splitSentences(text2);
  if (splitOn2 === "markdown") return splitMarkdown(text2, maxSize2);
  return splitParagraphs(text2);
}
function chunk(text2, options = {}) {
  validate(text2, options);
  const maxSize2 = options.maxSize ?? DEFAULTS.maxSize;
  const overlap2 = options.overlap ?? DEFAULTS.overlap;
  const unit2 = options.unit ?? "chars";
  const splitOn2 = options.splitOn ?? DEFAULTS.splitOn;
  const count = resolveCounter(unit2);
  const unitName = typeof unit2 === "function" ? "custom" : unit2;
  if (text2 === "" || count(text2) === 0) {
    if (text2 === "") return [];
    const segs = splitter(text2, splitOn2, maxSize2);
    if (segs.length === 0) return [];
  }
  const segments = splitter(text2, splitOn2, maxSize2);
  if (segments.length === 0) return [];
  const packed = [];
  let cur = null;
  const joinText = (parts) => parts.join("\n\n");
  for (const s of segments) {
    const sSize = count(s.text);
    if (sSize > maxSize2) {
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
    if (count(candidate) <= maxSize2) {
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
  const out = packed.map((p, i) => {
    let prefix = "";
    if (i > 0 && overlap2 > 0) {
      const prevRaw = packed[i - 1].text;
      prefix = overlapPrefix(prevRaw, overlap2, count, unitName === "custom" ? "chars" : unitName);
      if (prefix) {
        let candidate = prefix + "\n\n" + p.text;
        while (candidate && count(candidate) > maxSize2) {
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
    const c = { text: fullText, index: i, start: p.start, end: p.end };
    if (p.heading) c.heading = p.heading;
    if (p.oversized) c.oversized = true;
    return c;
  });
  return out;
}

// src/stream.ts
var import_node_fs = require("fs");

// bin/cli.ts
function arg(name, def) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const pref = process.argv.find((a) => a.startsWith(name + "="));
  if (pref) return pref.split("=").slice(1).join("=");
  return def;
}
var file = process.argv[2];
if (!file || file.startsWith("-")) {
  console.error("Usage: chunkkit <file> [--max-size N] [--overlap N] [--unit chars|words] [--split-on paragraph|sentence|markdown] [--json]");
  process.exit(1);
}
var maxSize = Number(arg("--max-size", "500"));
var overlap = Number(arg("--overlap", "0"));
var unit = arg("--unit", "chars") ?? "chars";
var splitOn = arg("--split-on", arg("--splitOn", "paragraph")) ?? "paragraph";
var asJson = process.argv.includes("--json");
var text = (0, import_node_fs2.readFileSync)(file, "utf8");
var chunks = chunk(text, { maxSize, overlap, unit, splitOn });
if (asJson) {
  console.log(JSON.stringify(chunks, null, 2));
} else {
  for (const c of chunks) {
    console.log(`--- chunk ${c.index} [${c.start}-${c.end}]${c.heading ? " " + c.heading : ""}${c.oversized ? " OVERSIZED" : ""} ---`);
    console.log(c.text);
    console.log();
  }
  console.error(`${chunks.length} chunk(s)`);
}
