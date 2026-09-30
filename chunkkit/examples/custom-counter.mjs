import { chunk } from "chunkkit";

// Pluggable tokenizer adapter (example: tiktoken — NOT a dependency).
// npm i tiktoken, then:
//   import { get_encoding } from "tiktoken";
//   const enc = get_encoding("cl100k_base");
//   const counter = (s) => enc.encode(s).length;
const approxTokenCounter = (s) => Math.ceil(s.length / 4);

const chunks = chunk("Long transcript ... ".repeat(50), {
  maxSize: 100, // 100 approx-tokens
  overlap: 10,
  unit: approxTokenCounter,
});
console.log(chunks.length, "chunks");
