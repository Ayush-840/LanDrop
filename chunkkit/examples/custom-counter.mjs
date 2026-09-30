import { chunk } from "@ayush-840/chunkkit";

// Token-accurate chunking: pass any tokenizer as the `unit` counter.
// chunkkit has zero dependencies — tiktoken here is the CALLER's dependency.
// npm i tiktoken  (then uncomment)

// import { getEncoding } from "tiktoken";
// const enc = getEncoding("cl100k_base");
// const countTokens = (s) => enc.encode(s).length;

// Fallback counter so the example runs without tiktoken installed:
const countTokens = (s) => Math.ceil(s.length / 4); // ~4 chars per token

const longText = "Retrieval quality depends on chunk boundaries. ".repeat(40);

const chunks = chunk(longText, {
  maxSize: 64,
  overlap: 8,
  unit: countTokens,
});

for (const c of chunks) {
  console.log(`chunk ${c.index}: ~${countTokens(c.text)} tokens, ${c.text.length} chars`);
}
