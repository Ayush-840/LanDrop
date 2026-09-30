import { chunk } from "chunkkit";

const text = "First paragraph about RAG.\n\nSecond paragraph about embeddings.\n\nThird paragraph about retrieval.";
const chunks = chunk(text, { maxSize: 40, overlap: 10 });
console.log(JSON.stringify(chunks, null, 2));
