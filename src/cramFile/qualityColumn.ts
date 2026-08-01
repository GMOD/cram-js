import { CramBufferOverrunError } from '../errors.ts'

import type { Cursor } from './codecs/_base.ts'

const INITIAL_BYTES = 65536

/**
 * The quality scores of every record in one slice, laid end to end, so that a
 * record needs only an offset into it rather than a `Uint8Array` of its own.
 *
 * A retained subarray view costs ~104 bytes in V8, more than the ~100 quality
 * bytes a short read points at — measured at 15% of everything a decoded
 * short-read slice retains, against 0.8% for long reads. This is the same trade
 * the read-feature arena makes, on the term that dominates the other end of the
 * read-length range. Records still expose the scores as
 * `CramRecord.qualityScores`, which builds the view on demand; nothing retains
 * one.
 */
export interface QualityColumn {
  /** shared by every record in the slice; replaced when a growable column grows */
  bytes: Uint8Array
  /** bytes in use, for a growable column */
  length: number
  /**
   * Set when `bytes` is the external QS block itself, which already holds the
   * scores end to end in record order — a record's scores are then read by
   * advancing the block cursor, with no copy and no second buffer. Undefined
   * when they have to be decoded value by value into a column of our own.
   */
  cursor: Cursor | undefined
}

/** A column over the QS block's own bytes; nothing is copied. */
export function externalQualityColumn(
  bytes: Uint8Array,
  cursor: Cursor,
): QualityColumn {
  return { bytes, length: bytes.length, cursor }
}

/** A column decoded into, for QS encodings that are not a plain external block. */
export function growableQualityColumn(): QualityColumn {
  return { bytes: new Uint8Array(INITIAL_BYTES), length: 0, cursor: undefined }
}

/**
 * Take one record's `readLength` quality scores into `column`, returning the
 * offset they start at.
 */
export function readQualityScores(
  column: QualityColumn,
  readLength: number,
  decodeQS: () => number,
) {
  const { cursor } = column
  if (cursor !== undefined) {
    const start = cursor.bytePosition
    const end = start + readLength
    if (end > column.bytes.length) {
      throw new CramBufferOverrunError(
        'attempted to read beyond end of block. this file seems truncated.',
      )
    }
    cursor.bytePosition = end
    return start
  }

  const start = column.length
  const end = start + readLength
  if (end > column.bytes.length) {
    let capacity = column.bytes.length * 2
    while (capacity < end) {
      capacity *= 2
    }
    const grown = new Uint8Array(capacity)
    grown.set(column.bytes.subarray(0, start))
    column.bytes = grown
  }
  const { bytes } = column
  for (let i = start; i < end; i++) {
    bytes[i] = decodeQS()
  }
  column.length = end
  return start
}

/**
 * Release the capacity a growable column over-allocated. Replaces `bytes`, so
 * records pointed at the old array have to be re-pointed afterwards.
 */
export function trimQualityColumn(column: QualityColumn) {
  if (column.cursor === undefined && column.length < column.bytes.length) {
    column.bytes = column.bytes.slice(0, column.length)
  }
}
