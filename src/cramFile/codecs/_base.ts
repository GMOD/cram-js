import type { CramFileBlock } from '../file.ts'
import type { DataType } from './dataSeriesTypes.ts'

export interface DataTypeMapping {
  byte: number
  int: number
  long: number
  byteArray: Uint8Array
}

export interface Cursor {
  bitPosition: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
  bytePosition: number
}

export interface PreDecodedIntBlock {
  values: Int32Array
  index: number
}

export interface Cursors {
  lastAlignmentStart: number
  coreBlock: Cursor
  externalBlocks: {
    getCursor: (contentId: number) => Cursor
  }
  preDecodedIntBlocks?: Map<number, PreDecodedIntBlock>
}

// codec base class
export default abstract class CramCodec<
  TResult extends DataType = DataType,
  TParameters = unknown,
> {
  public parameters: TParameters
  public dataType: DataType

  constructor(parameters: TParameters, dataType: TResult) {
    this.parameters = parameters
    this.dataType = dataType
  }

  abstract decode(
    coreDataBlock: CramFileBlock,
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ): DataTypeMapping[TResult]

  /**
   * `decode` with everything fixed for the slice resolved once: the content
   * block found, the cursor looked up, the pre-decoded block joined. Reading a
   * value is then a call on a closure over those, rather than a Record lookup
   * and a Map lookup back through the block index on every record.
   *
   * A codec that has a faster shape to offer overrides this; the default is the
   * generic `decode`, which is what Huffman, Beta, Gamma and Subexp use — their
   * state is in the codec already, so there is nothing per-slice to hoist.
   *
   * This is the seam that keeps a fast path from being conditional on more than
   * it needs. It used to live in `slice/decodeContext.ts` as an `instanceof`
   * chain, which meant each codec's fast path was written where that chain
   * could see it rather than where the codec's own knowledge is — and twice
   * over, a codec combination fell through it and paid full dispatch per
   * record.
   */
  bindDecoder(
    coreDataBlock: CramFileBlock | undefined,
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ): () => DataTypeMapping[TResult] {
    return () => this.decode(coreDataBlock!, blocksByContentId, cursors)
  }

  /**
   * A reader for `length` raw bytes at the cursor, bound to one slice the same
   * way — or undefined for a codec whose bytes are not laid out contiguously
   * and so cannot be handed out as a view. Callers fall back to reading a value
   * at a time.
   */
  bindBytesReader(
    _blocksByContentId: Record<number, CramFileBlock>,
    _cursors: Cursors,
  ): ((length: number) => Uint8Array) | undefined {
    return undefined
  }

  /**
   * A reader for one string at the cursor, bound to one slice — or undefined
   * for a codec with no better way to produce one than decoding the bytes and
   * handing them to {@link readNullTerminatedStringFromBuffer}, which is what
   * the caller falls back to.
   *
   * The point of the seam is that a codec may know its whole block is strings.
   * `byteArrayStop` with a stop byte of 0 does: the block is the values laid
   * end to end, each NUL-terminated, so *one* `TextDecoder` call and a `split`
   * yields all of them, where reading them one at a time is one call per
   * record. That is the difference between 12.9 ms and 1.7 ms for SRR396637's
   * 54,695 read names.
   */
  bindStringReader(
    _coreDataBlock: CramFileBlock | undefined,
    _blocksByContentId: Record<number, CramFileBlock>,
    _cursors: Cursors,
  ): (() => string) | undefined {
    return undefined
  }

  /** {@link bindBytesReader} for a caller that has not bound anything. */
  getBytesSubarray(
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
    length: number,
  ): Uint8Array | undefined {
    return this.bindBytesReader(blocksByContentId, cursors)?.(length)
  }
}
