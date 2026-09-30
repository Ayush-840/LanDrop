/** Error codes thrown by chunkkit. */
export type ChunkitErrorCode = "INVALID_OPTION" | "EMPTY_INPUT_UNIT";

/** The only error type chunkkit throws. Branch on `code`. */
export class ChunkitError extends Error {
  /** Machine-readable reason: `"INVALID_OPTION"` or `"EMPTY_INPUT_UNIT"`. */
  code: ChunkitErrorCode;

  constructor(message: string, code: ChunkitErrorCode) {
    super(message);
    this.name = "ChunkitError";
    this.code = code;
  }
}
