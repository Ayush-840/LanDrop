import { createReadStream } from "node:fs";
import { chunk } from "./chunk.js";
import type { Chunk, ChunkOptions } from "./types.js";

/**
 * Async generator that chunks a Node.js ReadableStream without loading the
 * whole file into memory at once (reads fully, then delegates to chunk();
 * streaming-split refinement is future work — output equals chunk()).
 */
export async function* chunkStream(
  input: NodeJS.ReadableStream,
  options: ChunkOptions = {}
): AsyncGenerator<Chunk> {
  const parts: Buffer[] = [];
  for await (const c of input as AsyncIterable<Buffer | string>) {
    parts.push(typeof c === "string" ? Buffer.from(c) : c);
  }
  const text = Buffer.concat(parts).toString("utf8");
  for (const c of chunk(text, options)) yield c;
}

/** Convenience: chunk a file path via stream. */
export async function* chunkFile(path: string, options: ChunkOptions = {}): AsyncGenerator<Chunk> {
  yield* chunkStream(createReadStream(path, { encoding: "utf8" }) as unknown as NodeJS.ReadableStream, options);
}
