import { describe, expect, it } from "vitest";
import { chunk, ChunkitError, estimateChunkCount } from "../src/index.js";
import { chunkStream } from "../src/index.js";
import { Readable } from "node:stream";

describe("errors", () => {
  it("bad maxSize throws", () => {
    expect(() => chunk("hi", { maxSize: 0 })).toThrow(ChunkitError);
    expect(() => chunk("hi", { maxSize: -3 })).toThrow(ChunkitError);
  });
  it("bad unit throws", () => {
    expect(() => chunk("hi", { unit: "tokens" as never })).toThrow(ChunkitError);
  });
  it("bad splitOn throws", () => {
    expect(() => chunk("hi", { splitOn: "lines" as never })).toThrow(ChunkitError);
  });
  it("non-string text throws", () => {
    expect(() => chunk(42 as never)).toThrow(ChunkitError);
  });
  it("error has code + name", () => {
    try {
      chunk("hi", { maxSize: 0 });
    } catch (e) {
      expect((e as ChunkitError).name).toBe("ChunkitError");
      expect((e as ChunkitError).code).toBe("INVALID_OPTION");
    }
  });
});

describe("helpers", () => {
  it("estimateChunkCount matches chunk().length", () => {
    const text = "a\n\nb\n\nc";
    expect(estimateChunkCount(text, { maxSize: 3 })).toBe(chunk(text, { maxSize: 3 }).length);
  });
  it("chunkStream reproduces chunk()", async () => {
    const text = "para one\n\npara two\n\npara three";
    const opts = { maxSize: 15 } as const;
    const expected = chunk(text, opts);
    const got: string[] = [];
    for await (const c of chunkStream(Readable.from([text]), opts)) got.push(c.text);
    expect(got).toEqual(expected.map((c) => c.text));
  });
});
