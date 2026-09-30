/** chunkkit — structure-aware text chunking for RAG & LLM pipelines. */
export { chunk, estimateChunkCount } from "./chunk.js";
export { chunkStream, chunkFile } from "./stream.js";
export { ChunkitError } from "./errors.js";
export type {
  Chunk,
  ChunkOptions,
  CounterFn,
  Unit,
  SplitOn,
  CountUnit,
  SplitStrategy,
} from "./types.js";
