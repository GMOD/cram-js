import {
  RF_DELETION,
  RF_HARD_CLIP,
  RF_INSERTION,
  RF_INSERT_BASE,
  RF_POSITIONAL,
  RF_REF_SKIP,
  RF_SOFT_CLIP,
  RF_SUBST,
} from './readFeatureArena.ts'

import type ReadFeatureArena from './readFeatureArena.ts'

/**
 * One difference between a read and the reference, as
 * {@link CramRecord.forEachMismatch} reports it.
 *
 * This is the level most consumers want. Walking `readFeatures` yourself means
 * knowing that `i` and `I` are both insertions but carry their payload
 * differently, that a run of `i` features is one insertion, that `q`/`Q` are
 * quality-only and their `refPos` is not an alignment position, that `b` is a
 * stretch of verbatim bases that align as matches, and that an `X` feature's
 * `data` is an index into the container's substitution matrix rather than a
 * base. Every one of those has been a bug in a downstream consumer.
 */
export interface Mismatch {
  /**
   * Which kind of difference, as the CIGAR-style char code it corresponds to:
   * `RF_SUBST` (X), `RF_INSERTION` (I), `RF_DELETION` (D), `RF_REF_SKIP` (N),
   * `RF_SOFT_CLIP` (S) or `RF_HARD_CLIP` (H). Insertions arrive as `RF_INSERTION`
   * whether the file encoded them as `I` or as a run of `i`.
   */
  code: number
  /** 1-based reference position the difference starts at */
  refPos: number
  /**
   * How many reference bases it covers: 1 for a substitution, the deleted or
   * skipped length for D/N, and 0 for insertions and clips, which consume read
   * bases without consuming reference.
   */
  length: number
  /**
   * The substituted base for X, or the inserted bases for an insertion; empty
   * for D/N/S/H, which have no bases of their own to report. 'N' for a
   * substitution whose base could not be resolved, which is what happens when
   * the file was read without a `seqFetch`.
   */
  bases: string
  /** quality score of a substituted base, or -1 when not stored in the file */
  qual: number
  /**
   * Char code of the reference base a substitution replaces, 0 when unknown
   * (again, no `seqFetch`). Upper-cased, since a soft-masked reference would
   * otherwise report lowercase.
   */
  refBaseCode: number
  /** read bases consumed: the inserted or clipped length; 0 otherwise */
  clipLength: number
}

export type MismatchCallback = (
  code: number,
  refPos: number,
  length: number,
  bases: string,
  qual: number,
  refBaseCode: number,
  clipLength: number,
) => void

export interface MismatchOptions {
  /** only report differences touching this 1-based closed reference range */
  start?: number
  end?: number
}

/**
 * Walk the differences a record's read features describe, without allocating
 * one object per difference.
 *
 * Reads the arena columns directly, so nothing here materialises a
 * `ReadFeature`. A run of single-base `i` insertions is accumulated into one
 * insertion, emitted at the position where the run starts and ahead of any
 * substitution at that same position, which is the order the read features
 * themselves are in.
 */
export function forEachMismatch(
  arena: ReadFeatureArena | undefined,
  featureStart: number,
  featureCount: number,
  qual: ArrayLike<number> | null | undefined,
  windowStart: number,
  windowEnd: number,
  callback: MismatchCallback,
) {
  if (arena !== undefined) {
    const hasQual = !!qual
    const { codes, pos, refPos, num, refCodes, subCodes } = arena
    const end = featureStart + featureCount
    let insertedBases = ''
    let insertedLength = 0
    let insertionPos = 0

    for (let i = featureStart; i < end; i++) {
      const code = codes[i]!
      // q/Q report where a quality score sits in the read, so their refPos is
      // not an alignment position — see RF_POSITIONAL. Letting one through here
      // would flush the insertion accumulator below and split one insertion in
      // two
      if (RF_POSITIONAL[code]) {
        const rPos = refPos[i]!

        // Flush an accumulated 'i' run before anything that is not another 'i'
        // continuing it. Flushing before rather than after is what puts the
        // insertion ahead of a substitution at the same position.
        if (
          insertedLength > 0 &&
          (code !== RF_INSERT_BASE || rPos !== insertionPos)
        ) {
          if (insertionPos >= windowStart && insertionPos <= windowEnd) {
            callback(
              RF_INSERTION,
              insertionPos,
              0,
              insertedBases,
              -1,
              0,
              insertedLength,
            )
          }
          insertedBases = ''
          insertedLength = 0
        }

        // the data value for D/N/H, the payload length for I/i/S
        const n = num[i]!
        const touchesWindow = rPos <= windowEnd && rPos >= windowStart

        if (code === RF_SUBST) {
          if (touchesWindow) {
            callback(
              RF_SUBST,
              rPos,
              1,
              // an unresolved substitution reads as N, matching getReadBases()
              // and the substitution matrix's own fallback row
              subCodes[i] ? String.fromCharCode(subCodes[i]!) : 'N',
              hasQual ? qual[pos[i]!]! : -1,
              // 0 stays 0 through the upper-casing, so an unknown reference
              // base keeps reporting as unknown
              refCodes[i]! & ~0x20,
              0,
            )
          }
        } else if (code === RF_INSERTION) {
          if (touchesWindow) {
            callback(RF_INSERTION, rPos, 0, arena.payloadStringAt(i), -1, 0, n)
          }
        } else if (code === RF_DELETION || code === RF_REF_SKIP) {
          // spans n reference bases, so it is in view if any of them are
          if (rPos <= windowEnd && rPos + n > windowStart) {
            callback(code, rPos, n, '', -1, 0, 0)
          }
        } else if (code === RF_SOFT_CLIP || code === RF_HARD_CLIP) {
          if (touchesWindow) {
            callback(code, rPos, 0, '', -1, 0, n)
          }
        } else if (code === RF_INSERT_BASE) {
          insertionPos = rPos
          insertedBases += arena.payloadStringAt(i)
          insertedLength += n
        }
        // b (verbatim bases) aligns as matches and P (padding) consumes
        // nothing, so neither is a difference to report
      }
    }

    if (
      insertedLength > 0 &&
      insertionPos >= windowStart &&
      insertionPos <= windowEnd
    ) {
      callback(
        RF_INSERTION,
        insertionPos,
        0,
        insertedBases,
        -1,
        0,
        insertedLength,
      )
    }
  }
}
