import { chunk } from "chunkkit";

// Real RAG use-case: chunk my own study notes (markdown) for embedding.
const notes = `# RAG Lecture Notes
Retrieval augmented generation grounds the model in your docs.

## Chunking
Keep headings with sections so each embedding has context.

## Retrieval
Embed each chunk, store in a vector DB, retrieve top-k at query time.
`;

const chunks = chunk(notes, { maxSize: 150, overlap: 20, splitOn: "markdown" });
for (const c of chunks) {
  console.log(`--- #${c.index} ${c.heading ?? ""} [${c.start}-${c.end}] ---`);
  console.log(c.text, "\n");
}
// Next step (your pipeline): embed c.text with your provider and upsert with {index, start, end, heading}.
