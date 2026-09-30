"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  ChunkitError: () => ChunkitError,
  chunk: () => chunk,
  chunkFile: () => chunkFile,
  chunkStream: () => chunkStream,
  estimateChunkCount: () => estimateChunkCount
});
module.exports = __toCommonJS(src_exports);

// src/counters.ts
var charCounter = (s) => s.length;
var wordCounter = (s) => {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
};
function resolveCounter(unit) {
  if (typeof unit === "function") return unit;
  if (unit === void 0 || unit === "chars") return charCounter;
  if (unit === "words") return wordCounter;
  return charCounter;
}
function takeTrailing(s, n, count, unit) {
  if (n <= 0 || !s) return "";
  if (unit === "words") {
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
function overlapPrefix(prevText, overlap, count, unit) {
  if (!overlap || !prevText) return "";
  return takeTrailing(prevText, overlap, count, unit);
}

// src/splitters/paragraph.ts
function splitParagraphs(text) {
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
  while ((m = re.exec(text)) !== null) {
    push(text.slice(start, m.index), start, m.index);
    start = m.index + m[0].length;
  }
  push(text.slice(start), start, text.length);
  return segs;
}

// src/splitters/markdown.ts
var HEADING_RE = /^#{1,6}\s+.+$/;
function splitMarkdown(text, maxCharsHint = Infinity) {
  const lines = text.split("\n");
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
    const end = endLine <= 0 ? text.length : offsets[endLine];
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
function splitSentencesIn(text, base) {
  const out = [];
  let start = 0;
  const n = text.length;
  let i = 0;
  const push = (s, e) => {
    const t = text.slice(s, e).trim();
    if (!t) return;
    const l = text.slice(s, e).indexOf(t);
    out.push({ text: t, start: base + s + l, end: base + s + l + t.length });
  };
  while (i < n) {
    const c = text[i];
    if (c === "." || c === "!" || c === "?") {
      if (c === ".") {
        const w = text.slice(Math.max(0, i - 6), i).split(/\s+/).pop()?.toLowerCase().replace(/\.+$/, "");
        if (w && ABBREV.has(w)) {
          i++;
          continue;
        }
      }
      const rest = text.slice(i + 1);
      const mm = rest.match(/^\s*(["'”’)\]]*\s*)(?=[A-Z0-9“"'\n]|$)/);
      if (mm || i + 1 >= n) {
        const end = mm ? i + 1 + mm[0].length : n;
        let e = i + 1;
        while (e < n && /["'”’)\]]/.test(text[e])) e++;
        push(start, e);
        let ns = e;
        while (ns < n && /\s/.test(text[ns])) ns++;
        start = ns;
        i = ns;
        continue;
      }
    }
    i++;
  }
  if (start < n) push(start, n);
  return out.length ? out : [{ text: text.trim(), start: base, end: base + text.length }];
}
function splitSentences(text) {
  const out = [];
  for (const p of splitParagraphs(text)) {
    for (const s of splitSentencesIn(p.text, p.start)) out.push(s);
  }
  return out;
}

// src/chunk.ts
var DEFAULTS = { maxSize: 1e3, overlap: 0, splitOn: "paragraph" };
function validate(text, o) {
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
function splitter(text, splitOn, maxSize) {
  if (splitOn === "sentence") return splitSentences(text);
  if (splitOn === "markdown") return splitMarkdown(text, maxSize);
  return splitParagraphs(text);
}
function chunk(text, options = {}) {
  validate(text, options);
  const maxSize = options.maxSize ?? DEFAULTS.maxSize;
  const overlap = options.overlap ?? DEFAULTS.overlap;
  const unit = options.unit ?? "chars";
  const splitOn = options.splitOn ?? DEFAULTS.splitOn;
  const count = resolveCounter(unit);
  const unitName = typeof unit === "function" ? "custom" : unit;
  if (text === "" || count(text) === 0) {
    if (text === "") return [];
    const segs = splitter(text, splitOn, maxSize);
    if (segs.length === 0) return [];
  }
  const segments = splitter(text, splitOn, maxSize);
  if (segments.length === 0) return [];
  const packed = [];
  let cur = null;
  const joinText = (parts) => parts.join("\n\n");
  for (const s of segments) {
    const sSize = count(s.text);
    if (sSize > maxSize) {
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
  const out = packed.map((p, i) => {
    let prefix = "";
    if (i > 0 && overlap > 0) {
      const prevRaw = packed[i - 1].text;
      prefix = overlapPrefix(prevRaw, overlap, count, unitName === "custom" ? "chars" : unitName);
      if (prefix) {
        let candidate = prefix + "\n\n" + p.text;
        while (candidate && count(candidate) > maxSize) {
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
function estimateChunkCount(text, options = {}) {
  return chunk(text, options).length;
}

// src/stream.ts
var import_node_fs = require("fs");
async function* chunkStream(input, options = {}) {
  const parts = [];
  for await (const c of input) {
    parts.push(typeof c === "string" ? Buffer.from(c) : c);
  }
  const text = Buffer.concat(parts).toString("utf8");
  for (const c of chunk(text, options)) yield c;
}
async function* chunkFile(path, options = {}) {
  yield* chunkStream((0, import_node_fs.createReadStream)(path, { encoding: "utf8" }), options);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ChunkitError,
  chunk,
  chunkFile,
  chunkStream,
  estimateChunkCount
});
