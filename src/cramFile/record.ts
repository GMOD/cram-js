import Constants from './constants.ts'
import { CramMalformedError } from '../errors.ts'
import { forEachMismatch } from './mismatches.ts'
import {
  RF_BASES,
  RF_BASE_QUAL,
  RF_DELETION,
  RF_HARD_CLIP,
  RF_INSERTION,
  RF_INSERT_BASE,
  RF_PADDING,
  RF_POSITIONAL,
  RF_REF_SKIP,
  RF_SOFT_CLIP,
  RF_SUBST,
} from './readFeatureArena.ts'

import type CramContainerCompressionScheme from './container/compressionScheme.ts'
import type {
  Mismatch,
  MismatchCallback,
  MismatchOptions,
} from './mismatches.ts'
import type ReadFeatureArena from './readFeatureArena.ts'
import type decodeRecord from './slice/decodeRecord.ts'

// Precomputed pair orientation strings, indexed by
//   ((flags >> 4) & 0x7) | (selfIsLeft ? 8 : 0)
// bits 0-2 are flag bits 0x10 (self reverse), 0x20 (mate reverse), 0x40 (read1);
// bit 3 is whether this record is the leftmost of the pair. The read2 flag (0x80)
// is deliberately not consulted — "not read1" is what decides the numbering, so
// a record with neither flag set reads the same as read2.
// SYNC: ~/src/gmod/bam-js src/record.ts PAIR_ORIENTATION_TABLE
// prettier-ignore
const PAIR_ORIENTATION_TABLE = [
  'F1F2','F1R2','R1F2','R1R2','F2F1','F2R1','R2F1','R2R1',
  'F2F1','R2F1','F2R1','R2R1','F1F2','R1F2','F1R2','R1R2',
]

export interface RefRegion {
  start: number
  end: number
  seq: string
}

interface ReadFeatureBase {
  pos: number
  refPos: number
}

/**
 * Read features describe differences between a read and the reference sequence.
 * Each feature has a code indicating the type of difference, a position in the
 * read (pos), and a position on the reference (refPos).
 */
export type ReadFeature =
  /** I=insertion, S=soft clip, b=bases, i=single-base insertion — all carry a sequence string */
  | (ReadFeatureBase & { code: 'I' | 'S' | 'b' | 'i'; data: string })
  /** B=base and quality pair — [substituted base, quality score] */
  | (ReadFeatureBase & { code: 'B'; data: [string, number] })
  /** X=base substitution — data is the substitution matrix index, ref/sub filled in by addReferenceSequence */
  | (ReadFeatureBase & {
      code: 'X'
      data: number
      ref?: string
      sub?: string
    })
  /** D=deletion, N=reference skip, H=hard clip, P=padding, Q=single quality score */
  | (ReadFeatureBase & { code: 'D' | 'N' | 'H' | 'P' | 'Q'; data: number })
  /** q=quality scores for a stretch of bases */
  | (ReadFeatureBase & { code: 'q'; data: number[] })

export interface DecodeOptions {
  /**
   * Whether to parse tags. Default true. If false, `record.tags` is empty and
   * the tag data is *dropped*, not kept for later — there is no lazy path back
   * to it, so re-decode the slice if you find you need the tags after all.
   */
  decodeTags?: boolean
}

export const defaultDecodeOptions: Required<DecodeOptions> = {
  decodeTags: true,
}

function decodeReadSequence(cramRecord: CramRecord, refRegion: RefRegion) {
  // if it has no length, it has no sequence
  if (!cramRecord.lengthOnRef && !cramRecord.readLength) {
    return null
  }

  if (cramRecord.isUnknownBases()) {
    return null
  }

  // remember: all coordinates are 0-based half-open
  const regionSeqOffset = cramRecord.start - refRegion.start

  const arena = cramRecord.readFeatureArena
  if (!arena) {
    return refRegion.seq
      .slice(regionSeqOffset, regionSeqOffset + (cramRecord.lengthOnRef || 0))
      .toUpperCase()
  }

  // Walk read features against the reference to reconstruct the read sequence.
  // See CRAMv3 §10.2 (Read features): https://samtools.github.io/hts-specs/CRAMv3.pdf
  const { codes, pos, num, subCodes } = arena
  const featureStart = cramRecord.readFeatureStart
  const featureCount = cramRecord.readFeatureCount
  let bases = ''
  let regionPos = regionSeqOffset
  let currentReadFeature = 0
  while (bases.length < cramRecord.readLength) {
    // Every iteration must either emit read bases or consume a feature, or the
    // walk cannot terminate. Malformed data reaches both dead ends: an FP delta
    // of 0 puts two base-consuming features at one read position, so the chunk
    // up to "the next feature" is empty and the feature is never consumed; and
    // read features inconsistent with lengthOnRef leave the reference region
    // too short to fill the read, so the trailing chunk is empty too. Either
    // way the loop below would spin forever on a file we cannot decode.
    const basesBefore = bases.length
    const featureBefore = currentReadFeature
    if (currentReadFeature < featureCount) {
      const i = featureStart + currentReadFeature
      const code = codes[i]!
      if (!RF_POSITIONAL[code]) {
        // q/Q describe quality, not geometry: consume the feature and neither
        // emit bases nor move along the reference
        currentReadFeature += 1
      } else if (pos[i] === bases.length) {
        currentReadFeature += 1
        if (code === RF_SUBST) {
          // an unresolved substitution reads as N, the same fallback the
          // substitution matrix uses for a reference base it does not know
          const subCode = subCodes[i]!
          bases += subCode ? String.fromCharCode(subCode) : 'N'
          regionPos += 1
        } else if (code === RF_BASE_QUAL) {
          bases += String.fromCharCode(arena.payloadBytesAt(i)[0]!)
          regionPos += 1
        } else if (code === RF_BASES) {
          bases += arena.payloadStringAt(i)
          regionPos += num[i]!
        } else if (
          code === RF_INSERTION ||
          code === RF_INSERT_BASE ||
          code === RF_SOFT_CLIP
        ) {
          bases += arena.payloadStringAt(i)
        } else if (code === RF_DELETION || code === RF_REF_SKIP) {
          regionPos += num[i]!
        }
        // H (hard clip), P (padding): do nothing
      } else {
        // put down a chunk of reference up to the next read feature
        const chunk = refRegion.seq.slice(
          regionPos,
          regionPos + pos[i]! - bases.length,
        )
        bases += chunk
        regionPos += chunk.length
      }
    } else {
      // put down a chunk of reference up to the full read length
      const chunk = refRegion.seq.slice(
        regionPos,
        regionPos + cramRecord.readLength - bases.length,
      )
      bases += chunk
      regionPos += chunk.length
    }
    if (bases.length === basesBefore && currentReadFeature === featureBefore) {
      throw new CramMalformedError(
        `could not decode read bases for ${cramRecord.sequenceId}:${cramRecord.start}: stuck at ${bases.length} of ${cramRecord.readLength} bases, read feature ${currentReadFeature} of ${featureCount}. this file seems malformed`,
      )
    }
  }

  return bases.toUpperCase()
}

const baseNumbers: Record<string, number | undefined> = {
  a: 0,
  A: 0,
  c: 1,
  C: 1,
  g: 2,
  G: 2,
  t: 3,
  T: 3,
  n: 4,
  N: 4,
}

function decodeBaseSubstitution(
  arena: ReadFeatureArena,
  index: number,
  refRegion: RefRegion,
  compressionScheme: CramContainerCompressionScheme,
) {
  // decode base substitution code using the substitution matrix
  const refCoord = arena.refPos[index]! - refRegion.start
  const refBase = refRegion.seq.charAt(refCoord)
  if (refBase) {
    arena.refCodes[index] = refBase.charCodeAt(0)
  }
  // anything that is not a called base substitutes through the N row
  const baseNumber = baseNumbers[refBase] ?? 4
  const substitutionScheme = compressionScheme.substitutionMatrix[baseNumber]!
  const base = substitutionScheme[arena.num[index]!]
  if (base) {
    arena.subCodes[index] = base.charCodeAt(0)
  }
}

export interface MateRecord {
  readName?: string
  sequenceId: number
  /** 0-based */
  start: number
  flags?: number

  uniqueId?: number
}

export const BamFlags = [
  [0x1, 'Paired'],
  [0x2, 'ProperlyPaired'],
  [0x4, 'SegmentUnmapped'],
  [0x8, 'MateUnmapped'],
  [0x10, 'ReverseComplemented'],
  //  the mate is mapped to the reverse strand
  [0x20, 'MateReverseComplemented'],
  //  this is read1
  [0x40, 'Read1'],
  //  this is read2
  [0x80, 'Read2'],
  //  not primary alignment
  [0x100, 'Secondary'],
  //  QC failure
  [0x200, 'FailedQc'],
  //  optical or PCR duplicate
  [0x400, 'Duplicate'],
  //  supplementary alignment
  [0x800, 'Supplementary'],
] as const

export const CramFlags = [
  [0x1, 'PreservingQualityScores'],
  [0x2, 'Detached'],
  [0x4, 'WithMateDownstream'],
  [0x8, 'DecodeSequenceAsStar'],
] as const

export const MateFlags = [
  [0x1, 'OnNegativeStrand'],
  [0x2, 'Unmapped'],
] as const

type FlagsDecoder<Type> = {
  [Property in Type as `is${Capitalize<string & Property>}`]: (
    flags: number,
  ) => boolean
}

type FlagsEncoder<Type> = {
  [Property in Type as `set${Capitalize<string & Property>}`]: (
    flags: number,
  ) => number
}

function makeFlagsHelper<T>(
  x: readonly (readonly [number, T])[],
): FlagsDecoder<T> & FlagsEncoder<T> {
  const r: Record<string, (flags: number) => boolean | number> = {}
  for (const [code, name] of x) {
    r[`is${name}`] = (flags: number) => !!(flags & code)
    r[`set${name}`] = (flags: number) => flags | code
  }

  return r as unknown as FlagsDecoder<T> & FlagsEncoder<T>
}

export const BamFlagsDecoder = makeFlagsHelper(BamFlags)
export const CramFlagsDecoder = makeFlagsHelper(CramFlags)
export const MateFlagsDecoder = makeFlagsHelper(MateFlags)

/**
 * Class of each CRAM record returned by this API.
 */
export default class CramRecord {
  public tags: Record<string, string | number | number[] | undefined>
  public flags: number
  public cramFlags: number
  public readBases?: string | null
  public _refRegion?: RefRegion
  /**
   * Columnar storage for this record's read features, shared with every other
   * record in the same slice; undefined when the record has none. Read them
   * through the columns rather than through {@link readFeatures}, which
   * rebuilds an array of objects on every access.
   */
  public readFeatureArena: ReadFeatureArena | undefined
  /** index of this record's first read feature in {@link readFeatureArena} */
  public readFeatureStart: number
  public readFeatureCount: number
  /** 0-based start of the alignment on the reference */
  public start: number
  public lengthOnRef: number | undefined
  public readLength: number
  // templateLength is computed post-hoc for intra-slice mate pairs,
  // templateSize is the raw CRAM-encoded TS data series value
  public templateLength?: number
  public templateSize?: number
  /**
   * The read's name, or undefined for a file that does not store them and a
   * record that mate association could not give a synthetic one to.
   *
   * Decoded during the slice decode rather than deferred behind the raw bytes:
   * a retained `Uint8Array` view is ~104 bytes against ~56 for the name it
   * holds, so holding one to avoid a decode cost almost twice what it saved.
   */
  public readName: string | undefined
  public mateRecordNumber?: number
  public mate?: MateRecord
  public uniqueId: number
  public sequenceId: number
  public readGroupId: number
  public mappingQuality: number | undefined
  /**
   * Every quality score in this record's slice, laid end to end and shared with
   * every other record in it; undefined when this record carries none. Read
   * this record's own scores as `qualityColumn[qualityStart + i]` for
   * `i < readLength` — {@link qualityScores} wraps that in a view, which costs
   * more than the scores themselves.
   */
  public qualityColumn: Uint8Array | undefined
  /** offset of this record's scores in {@link qualityColumn} */
  public qualityStart: number

  /**
   * This record's read features as the array of `{code, pos, refPos, data}`
   * objects this library has always handed out.
   *
   * Rebuilt from the arena columns on every access, so a consumer that walks
   * these more than once, or that walks many records, should read
   * {@link readFeatureArena} directly — materialising them is what the columnar
   * layout exists to avoid.
   */
  get readFeatures(): ReadFeature[] | undefined {
    return this.readFeatureArena?.materialize(
      this.readFeatureStart,
      this.readFeatureCount,
    )
  }

  /**
   * Assigning read features is no longer supported — this exists only so the
   * failure says what to do instead of V8's "has only a getter".
   *
   * There is deliberately no working setter. It would fix the one break that
   * already fails loudly while leaving the two that fail silently: the array is
   * rebuilt per access, so it has no stable identity, and mutating a feature
   * from it writes into a throwaway object. Both would need the materialised
   * array memoised, which retains the objects *and* the columns — more memory
   * than before the columns existed — and lets the two representations
   * disagree, while consumers on the fast path read the columns.
   */
  set readFeatures(_value: ReadFeature[] | undefined) {
    throw new TypeError(
      'CramRecord.readFeatures is read-only: it is rebuilt from the columnar ' +
        'arena on every access. To build a record from plain read features, ' +
        'pass arenaFromReadFeatures(features) as readFeatureArena with ' +
        'readFeatureStart 0 and readFeatureCount features.length. To read them, ' +
        'use the readFeatureArena columns.',
    )
  }

  /**
   * This record's per-base quality scores, or null for a '*' record that has
   * neither bases nor scores, or undefined when the file did not preserve them.
   *
   * Built on every access as a view over {@link qualityColumn}, which is where
   * the scores actually live — a retained view costs ~104 bytes in V8, more
   * than the scores of a short read. A hot path should index the column.
   */
  get qualityScores(): Uint8Array | null | undefined {
    const column = this.qualityColumn
    if (column === undefined) {
      // the '*' case reported null rather than undefined before the scores
      // moved into a column, and the flags say which case this is
      return this.isSegmentUnmapped() && this.isUnknownBases()
        ? null
        : undefined
    }
    return column.subarray(
      this.qualityStart,
      this.qualityStart + this.readLength,
    )
  }

  /**
   * The quality score of the read base at 0-based read position `pos`, or -1
   * when the file did not preserve quality scores.
   *
   * The allocation-free way to read a handful of scores — reaching for
   * {@link qualityScores} to index it once builds a view over the whole read.
   * A walk over *every* base should instead hoist {@link qualityColumn} and
   * {@link qualityStart} out of its loop.
   */
  qualityScoreAt(pos: number) {
    const column = this.qualityColumn
    return column === undefined ? -1 : column[this.qualityStart + pos]!
  }

  /**
   * Give a record whose file stored no read name the synthetic one its pair
   * shares, without disturbing a name that was stored. Called by mate
   * association; there is nothing here for a caller to do.
   */
  setSyntheticReadName(name: string) {
    if (!this.readName) {
      this.readName = name
    }
  }

  constructor({
    flags,
    cramFlags,
    readLength,
    mappingQuality,
    lengthOnRef,
    qualityColumn,
    qualityStart,
    mateRecordNumber,
    readBases,
    readFeatureArena,
    readFeatureStart,
    readFeatureCount,
    mate,
    readGroupId,
    readName,
    sequenceId,
    uniqueId,
    templateSize,
    start,
    tags,
  }: ReturnType<typeof decodeRecord>) {
    this.flags = flags
    this.cramFlags = cramFlags
    this.readLength = readLength
    this.mappingQuality = mappingQuality
    this.lengthOnRef = lengthOnRef
    this.qualityColumn = qualityColumn
    this.qualityStart = qualityStart
    this.readGroupId = readGroupId
    this.sequenceId = sequenceId!
    this.uniqueId = uniqueId
    this.start = start
    this.tags = tags
    this.readName = readName
    if (readBases) {
      this.readBases = readBases
    }
    this.templateSize = templateSize
    this.readFeatureArena = readFeatureArena
    this.readFeatureStart = readFeatureStart
    this.readFeatureCount = readFeatureCount
    if (mate) {
      this.mate = mate
    }
    if (mateRecordNumber !== undefined) {
      this.mateRecordNumber = mateRecordNumber
    }
  }

  // BAM flags — see SAM/BAM spec §1.4 (Flag field):
  // https://samtools.github.io/hts-specs/SAMv1.pdf
  /** @returns {boolean} true if the read is paired, regardless of whether both segments are mapped */
  isPaired() {
    return !!(this.flags & Constants.BAM_FPAIRED)
  }
  /** @returns {boolean} true if the read is paired, and both segments are mapped */
  isProperlyPaired() {
    return !!(this.flags & Constants.BAM_FPROPER_PAIR)
  }
  /** @returns {boolean} true if the read itself is unmapped; conflictive with isProperlyPaired */
  isSegmentUnmapped() {
    return !!(this.flags & Constants.BAM_FUNMAP)
  }
  /** @returns {boolean} true if the mate is unmapped; conflictive with isProperlyPaired */
  isMateUnmapped() {
    return !!(this.flags & Constants.BAM_FMUNMAP)
  }
  /** @returns {boolean} true if the read is mapped to the reverse strand */
  isReverseComplemented() {
    return !!(this.flags & Constants.BAM_FREVERSE)
  }
  /** @returns {boolean} true if the mate is mapped to the reverse strand */
  isMateReverseComplemented() {
    return !!(this.flags & Constants.BAM_FMREVERSE)
  }
  isRead1() {
    return !!(this.flags & Constants.BAM_FREAD1)
  }
  isRead2() {
    return !!(this.flags & Constants.BAM_FREAD2)
  }
  isSecondary() {
    return !!(this.flags & Constants.BAM_FSECONDARY)
  }
  isFailedQc() {
    return !!(this.flags & Constants.BAM_FQCFAIL)
  }
  isDuplicate() {
    return !!(this.flags & Constants.BAM_FDUP)
  }
  isSupplementary() {
    return !!(this.flags & Constants.BAM_FSUPPLEMENTARY)
  }

  // CRAM-specific compression flags — see CRAMv3 §8.4 (Bit Flags):
  // https://samtools.github.io/hts-specs/CRAMv3.pdf
  isDetached() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_DETACHED)
  }
  hasMateDownStream() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_MATE_DOWNSTREAM)
  }
  isPreservingQualityScores() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_PRESERVE_QUAL_SCORES)
  }
  isUnknownBases() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_NO_SEQ)
  }

  /**
   * Get the original sequence of this read.
   * @returns {String} sequence basepairs
   */
  getReadBases() {
    if (!this.readBases && this._refRegion) {
      const decoded = decodeReadSequence(this, this._refRegion)
      if (decoded) {
        this.readBases = decoded
      }
    }
    return this.readBases
  }

  /**
   * Get the CIGAR string describing this read's alignment against the
   * reference, reconstructed from the read features. Substitutions and
   * verbatim bases are reported as alignment matches (M), following the plain
   * CIGAR convention where M covers both matches and mismatches. Unmapped
   * reads return '*'.
   *
   * See CRAMv3 §10.2 (Read features):
   * https://samtools.github.io/hts-specs/CRAMv3.pdf
   *
   * @returns {string} the CIGAR string, e.g. "50M2I48M"
   */
  getCigarString(): string {
    if (this.isSegmentUnmapped()) {
      return '*'
    }

    // build up (length, op) pairs, merging adjacent runs of the same op so
    // e.g. consecutive single-base insertions collapse into one I operation
    const ops: [number, string][] = []
    const push = (len: number, op: string) => {
      if (len > 0) {
        const last = ops.at(-1)
        if (last?.[1] === op) {
          last[0] += len
        } else {
          ops.push([len, op])
        }
      }
    }

    let readConsumed = 0
    let refPos = this.start

    const arena = this.readFeatureArena
    if (arena !== undefined) {
      const { codes, num } = arena
      const end = this.readFeatureStart + this.readFeatureCount
      for (let i = this.readFeatureStart; i < end; i++) {
        const code = codes[i]!
        // skips q/Q, whose refPos would perturb the position tracking below
        if (RF_POSITIONAL[code]) {
          // reference bases between the last position and this feature are matches
          const gap = arena.refPos[i]! - refPos
          push(gap, 'M')
          readConsumed += gap
          refPos = arena.refPos[i]!

          // `num` is the data value for D/N/P/H and the payload length for
          // b/I/S/i, so both kinds read the same way here
          const n = num[i]!
          if (code === RF_SUBST || code === RF_BASE_QUAL) {
            // single-base (substitution or base+quality), aligned as a match
            push(1, 'M')
            readConsumed += 1
            refPos += 1
          } else if (code === RF_BASES) {
            // verbatim stretch of bases, aligned as matches
            push(n, 'M')
            readConsumed += n
            refPos += n
          } else if (code === RF_DELETION || code === RF_REF_SKIP) {
            push(n, code === RF_DELETION ? 'D' : 'N')
            refPos += n
          } else if (code === RF_INSERTION || code === RF_INSERT_BASE) {
            push(n, 'I')
            readConsumed += n
          } else if (code === RF_SOFT_CLIP) {
            push(n, 'S')
            readConsumed += n
          } else if (code === RF_PADDING || code === RF_HARD_CLIP) {
            push(n, code === RF_PADDING ? 'P' : 'H')
          }
        }
      }
    }

    // any read bases past the last feature are trailing matches
    push(this.readLength - readConsumed, 'M')

    // a mapped record can still have no operations at all — htslib's xx#minimal
    // carries five with a zero read length whose one feature is a zero-length
    // op — and '*' is how SAM spells an absent CIGAR, which is what samtools
    // prints for them. Returning '' there would be invalid SAM
    return ops.length ? ops.map(([len, op]) => `${len}${op}`).join('') : '*'
  }

  /**
   * Report each difference between this read and the reference — substitutions,
   * insertions, deletions, reference skips and clips — without allocating an
   * object per difference. This is the intended way to read a record's
   * differences; {@link readFeatures} hands out the raw CRAM features, which
   * takes rather more of the format to interpret correctly (see
   * {@link Mismatch}).
   *
   * `ref`/`sub` bases and quality scores are only as populated as the file and
   * the `seqFetch` allowed: without a reference, a substitution reports as 'N'
   * with a `refBaseCode` of 0.
   *
   * @param callback called as
   *   `(code, refPos, length, bases, qual, refBaseCode, clipLength)`
   * @param opts optional 1-based closed reference range to restrict to
   */
  forEachMismatch(callback: MismatchCallback, opts?: MismatchOptions) {
    forEachMismatch(
      this.readFeatureArena,
      this.readFeatureStart,
      this.readFeatureCount,
      this.qualityColumn,
      this.qualityStart,
      opts?.start ?? Number.NEGATIVE_INFINITY,
      opts?.end ?? Number.POSITIVE_INFINITY,
      callback,
    )
  }

  /**
   * The same differences {@link forEachMismatch} reports, as an array of
   * {@link Mismatch} objects. Convenient; allocates one object per difference,
   * so the callback form is the one to reach for on a hot path.
   */
  getMismatches(opts?: MismatchOptions) {
    const out: Mismatch[] = []
    this.forEachMismatch(
      (code, refPos, length, bases, qual, refBaseCode, clipLength) => {
        out.push({
          code,
          refPos,
          length,
          bases,
          qual,
          refBaseCode,
          clipLength,
        })
      },
      opts,
    )
    return out
  }

  // Must come out identical from either mate, or the two halves of one normal
  // pair render as different orientations. The leftmost mate is therefore picked
  // by a total order on (sequenceId, start) that both mates evaluate the
  // same way, with a read1-first tie-break for equal loci; when the mate is
  // unknown the read1-first rule alone still keeps the two consistent.
  //
  // Deriving "leftmost" from template length looks tempting — the spec makes it
  // positive for the leftmost segment and negative for the rightmost — but it is
  // left at 0 whenever the insert size is unavailable, which includes every
  // cross-reference pair. Both mates then read as "not leftmost" and disagree.
  // SYNC: ~/src/gmod/bam-js src/record.ts pair_orientation getter
  getPairOrientation() {
    const f = this.flags
    if (!(f & Constants.BAM_FPAIRED)) {
      return undefined
    }
    const isRead1 = !!(f & Constants.BAM_FREAD1)
    const mate = this.mate
    const selfIsLeft =
      mate === undefined
        ? isRead1
        : this.sequenceId !== mate.sequenceId
          ? this.sequenceId < mate.sequenceId
          : this.start !== mate.start
            ? this.start < mate.start
            : isRead1
    return PAIR_ORIENTATION_TABLE[((f >> 4) & 0x7) | (selfIsLeft ? 8 : 0)]
  }

  /**
   * Annotates this feature with the given reference sequence basepair
   * information. This will add a `sub` and a `ref` item to base
   * substitution read features given the actual substituted and reference
   * base pairs, and will make the `getReadBases()` method work.
   *
   * @param {object} refRegion
   * @param {number} refRegion.start
   * @param {number} refRegion.end
   * @param {string} refRegion.seq
   * @param {CramContainerCompressionScheme} compressionScheme
   * @returns {undefined} nothing
   */
  addReferenceSequence(
    refRegion: RefRegion,
    compressionScheme: CramContainerCompressionScheme,
  ) {
    const arena = this.readFeatureArena
    if (arena) {
      // use the reference bases to decode the bases substituted in each base
      // substitution
      const { codes } = arena
      const end = this.readFeatureStart + this.readFeatureCount
      for (let i = this.readFeatureStart; i < end; i++) {
        if (codes[i] === RF_SUBST) {
          decodeBaseSubstitution(arena, i, refRegion, compressionScheme)
        }
      }
    }

    // if this region completely covers this read,
    // keep a reference to it
    if (
      !this.readBases &&
      refRegion.start <= this.start &&
      refRegion.end >= this.start + (this.lengthOnRef || this.readLength)
    ) {
      this._refRegion = refRegion
    }
  }

  // Serializer used by snapshot tests and consumers that JSON.stringify a
  // record. qualityScores (Uint8Array) is converted to number[] so snapshots
  // stay diffable. Optional fields are added only when defined to match the
  // historical shape of the output.
  toJSON() {
    // read once: the getter builds a fresh view over the quality column
    const qualityScores = this.qualityScores
    const data: Record<string, unknown> = {
      start: this.start,
      cramFlags: this.cramFlags,
      flags: this.flags,
      readGroupId: this.readGroupId,
      readLength: this.readLength,
      sequenceId: this.sequenceId,
      tags: this.tags,
      uniqueId: this.uniqueId,
      readName: this.readName,
      readBases: this.getReadBases(),
      qualityScores: qualityScores ? Array.from(qualityScores) : qualityScores,
    }
    if (this.lengthOnRef !== undefined) {
      data.lengthOnRef = this.lengthOnRef
    }
    if (this.mappingQuality !== undefined) {
      data.mappingQuality = this.mappingQuality
    }
    if (this.templateSize !== undefined) {
      data.templateSize = this.templateSize
    }
    if (this.templateLength !== undefined) {
      data.templateLength = this.templateLength
    }
    // read once: the getter rebuilds the array-of-structs view on every access
    const readFeatures = this.readFeatures
    if (readFeatures !== undefined) {
      data.readFeatures = readFeatures
    }
    if (this.mate !== undefined) {
      data.mate = this.mate
    }
    if (this.mateRecordNumber !== undefined) {
      data.mateRecordNumber = this.mateRecordNumber
    }
    return data
  }
}

export { CramRecord }
