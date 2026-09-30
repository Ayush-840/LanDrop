import { readFileSync } from "node:fs";
import { chunk } from "@ayush-840/chunkkit";

// RAG preprocessing: chunk a markdown doc, keeping section headings with
// their content so every embedded record knows where it came from.
const doc = readFileSync(new URL("../README.md", import.meta.url), "utf8");

const chunks = chunk(doc, { maxSize: 500, overlap: 50, splitOn: "markdown" });

const records = chunks.map((c) => ({
  section: c.heading ?? "(top)",
  text: c.text,
  location: [c.start, c.end],
}));

console.log(JSON.stringify(records.slice(0, 3), null, 2));
console.error(`${records.length} chunk(s) ready for embedding`);
