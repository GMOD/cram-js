import {
  CIGAR_DEL,
  CIGAR_HARD_CLIP,
  CIGAR_INS,
  CIGAR_MATCH,
  CIGAR_OP_CHARS,
  CIGAR_PAD,
  CIGAR_REF_SKIP,
  CIGAR_SOFT_CLIP,
} from './cigar.ts'
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
import { decodeUtf8 } from './util.ts'

import type { CigarCallback } from './cigar.ts'
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

  // long reads go bytewise; the short-read walk stays inline below so that the
  // common case pays one comparison and no extra call
  if (cramRecord.readLength >= BYTEWISE_READ_BASES_MIN) {
    return decodeReadSequenceBytes(
      cramRecord,
      arena,
      refRegion,
      regionSeqOffset,
    )
  }
  return decodeReadSequenceString(cramRecord, arena, refRegion, regionSeqOffset)
}

/**
 * Above this read length, reconstruct the read into a byte array; below it,
 * concatenate a string.
 *
 * The byte form avoids a `TextDecoder` call per insertion and soft clip, a
 * `String.fromCharCode` per substitution, a substring per reference chunk, and
 * the flatten of the whole rope that `toUpperCase` used to force — worth **-56%**
 * on 628 49kb reads (1098 ms -> 480 ms). But it puts a typed-array allocation
 * and one `TextDecoder` call on every record, and on a 100bp short read that
 * fixed cost swamps the work: **+141%** on SRR396637 and **+253%** on
 * SRR396636, where a substring plus a native `toUpperCase` is simply cheaper.
 * Same trade as the read-feature arena and the typed CIGAR — see TODO.md.
 *
 * Both forms produce byte-identical output on every record of all three
 * datasets. The exact crossover is unmeasured: what is measured is 100bp
 * (string wins hard) and 49kb (bytes win hard), and 1000 separates every real
 * short-read platform from every real long-read one.
 */
const BYTEWISE_READ_BASES_MIN = 1000

/** the byte-array reconstruction — see {@link BYTEWISE_READ_BASES_MIN} */
function decodeReadSequenceBytes(
  cramRecord: CramRecord,
  arena: ReadFeatureArena,
  refRegion: RefRegion,
  regionSeqOffset: number,
) {
  const { codes, pos, num, subCodes } = arena
  const { payloadBytes, payloadOffsets } = arena
  const refSeq = refRegion.seq
  const readLength = cramRecord.readLength
  const featureStart = cramRecord.readFeatureStart
  const featureCount = cramRecord.readFeatureCount

  // readLength is the answer's length for any well-formed record; `grow` covers
  // the malformed ones, which the string form let run past it rather than
  // truncating
  let out = new Uint8Array(readLength)
  let outPos = 0
  let regionPos = regionSeqOffset
  const grow = (needed: number) => {
    if (needed > out.length) {
      const bigger = new Uint8Array(Math.max(needed, out.length * 2))
      bigger.set(out.subarray(0, outPos))
      out = bigger
    }
  }
  const malformed = () => {
    throw new CramMalformedError(
      `could not decode read bases for ${cramRecord.sequenceId}:${cramRecord.start}: stuck at ${outPos} of ${readLength} bases. this file seems malformed`,
    )
  }
  /** reference bases are the bulk of a read, and may be soft-masked lowercase */
  const copyReference = (count: number) => {
    if (regionPos < 0 || regionPos + count > refSeq.length) {
      // read features inconsistent with lengthOnRef leave the region too short
      // to fill the read; the string form emitted an empty chunk and spun
      malformed()
    }
    grow(outPos + count)
    for (let j = 0; j < count; j++) {
      const c = refSeq.charCodeAt(regionPos + j)
      out[outPos + j] = c >= 97 && c <= 122 ? c - 32 : c
    }
    outPos += count
    regionPos += count
  }

  for (let f = 0; f < featureCount && outPos < readLength; f++) {
    const i = featureStart + f
    const code = codes[i]!
    // q/Q describe quality, not geometry: neither emits bases nor moves along
    // the reference
    if (!RF_POSITIONAL[code]) {
      continue
    }
    const featurePos = pos[i]!
    if (featurePos > outPos) {
      // put down a chunk of reference up to this read feature
      copyReference(featurePos - outPos)
    } else if (featurePos < outPos) {
      // an FP delta of 0 puts two base-consuming features at one read position;
      // the string form emitted an empty chunk here and never consumed either
      malformed()
    }

    if (code === RF_SUBST) {
      // an unresolved substitution reads as N, the same fallback the
      // substitution matrix uses for a reference base it does not know
      grow(outPos + 1)
      // upper-cased like every other byte written here: the substitution matrix
      // only ever emits upper case, but the string form this replaced
      // upper-cased the whole read at the end, so anything else would be a
      // difference between the two paths waiting on the right file
      const sub = subCodes[i] || 0x4e /* N */
      out[outPos++] = sub >= 97 && sub <= 122 ? sub - 32 : sub
      regionPos += 1
    } else if (code === RF_BASE_QUAL) {
      grow(outPos + 1)
      const base = payloadBytes[payloadOffsets[i]!]!
      out[outPos++] = base >= 97 && base <= 122 ? base - 32 : base
      regionPos += 1
    } else if (
      code === RF_BASES ||
      code === RF_INSERTION ||
      code === RF_INSERT_BASE ||
      code === RF_SOFT_CLIP
    ) {
      // the payload is already bytes in the arena, so no decode is needed here
      const n = num[i]!
      const off = payloadOffsets[i]!
      grow(outPos + n)
      for (let j = 0; j < n; j++) {
        const c = payloadBytes[off + j]!
        out[outPos + j] = c >= 97 && c <= 122 ? c - 32 : c
      }
      outPos += n
      // verbatim bases consume reference; inserted and clipped bases do not
      if (code === RF_BASES) {
        regionPos += n
      }
    } else if (code === RF_DELETION || code === RF_REF_SKIP) {
      regionPos += num[i]!
    }
    // H (hard clip), P (padding): do nothing
  }

  // any read bases past the last feature come from the reference
  if (outPos < readLength) {
    copyReference(readLength - outPos)
  }

  return decodeUtf8(outPos === out.length ? out : out.subarray(0, outPos))
}

/**
 * The string reconstruction, for short reads — see
 * {@link BYTEWISE_READ_BASES_MIN}. Walks read features against the reference,
 * per CRAMv3 §10.2: https://samtools.github.io/hts-specs/CRAMv3.pdf
 */
function decodeReadSequenceString(
  cramRecord: CramRecord,
  arena: ReadFeatureArena,
  refRegion: RefRegion,
  regionSeqOffset: number,
) {
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
          bases += String.fromCharCode(arena.payloadByteAt(i))
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
   * Walk this read's alignment against the reference one CIGAR operation at a
   * time, without building a CIGAR of any kind. `callback` is called in order
   * with the op as one of the `CIGAR_*` codes and how many bases it covers.
   *
   * This is the primitive the CIGAR is reconstructed by, and the level to reach
   * for whenever the answer is a measurement rather than a string — a clip
   * length, a reference span, an op histogram. {@link getCigarString} is this
   * walk plus a string; a consumer that wants the ops packed as BAM stores them
   * can build `(length << 4) | op` from it and choose its own array type.
   *
   * Unlike `@gmod/bam`, which hands out a zero-copy view of the packed CIGAR
   * the file already contains, CRAM stores no CIGAR at all — it is always
   * reconstructed from the read features, so any array form would be an
   * allocation this library invented and imposed. Hence the callback, matching
   * {@link forEachMismatch}.
   *
   * Substitutions and verbatim bases are reported as alignment matches (M),
   * following the plain CIGAR convention where M covers both matches and
   * mismatches. Adjacent runs of the same op are merged and zero-length ops are
   * dropped, so a record with two hard clips and nothing between them emits one
   * 10H rather than 5H5H. An unmapped read emits nothing.
   *
   * See CRAMv3 §10.2 (Read features):
   * https://samtools.github.io/hts-specs/CRAMv3.pdf
   */
  forEachCigarOp(callback: CigarCallback) {
    if (this.isSegmentUnmapped()) {
      return
    }

    // One pending (op, length) run, held in locals. Every emit point below
    // either extends it or flushes it and starts a new one, which is what
    // merges adjacent same-op features and drops the zero-length ops htslib's
    // xx#minimal fixtures carry — and it is why the callback fires once per
    // *run* rather than once per read feature.
    //
    // The coalescing is written out at each of the three emit points rather
    // than factored into a `push(len, op)` closure. That closure has to capture
    // and mutate `op`/`oplen`, so V8 allocates a context for it on every call —
    // measured at +40% on short-read files, where a record averages 1.3
    // operations and so is dominated by per-call cost, and +10% on ONT.
    let op = CIGAR_MATCH
    let oplen = 0

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
          if (gap > 0) {
            if (op === CIGAR_MATCH) {
              oplen += gap
            } else {
              if (oplen > 0) {
                callback(op, oplen)
              }
              op = CIGAR_MATCH
              oplen = gap
            }
            readConsumed += gap
          }
          refPos = arena.refPos[i]!

          // Reduce the feature to the one operation it contributes, then emit
          // it through the single coalescing block below. `num` is the data
          // value for D/N/P/H and the payload length for b/I/S/i, so both kinds
          // read their length from the same column.
          const n = num[i]!
          let emitOp = CIGAR_MATCH
          let emitLen = 0
          if (code === RF_SUBST || code === RF_BASE_QUAL) {
            // single-base (substitution or base+quality), aligned as a match
            emitLen = 1
            readConsumed += 1
            refPos += 1
          } else if (code === RF_BASES) {
            // verbatim stretch of bases, aligned as matches
            emitLen = n
            readConsumed += n
            refPos += n
          } else if (code === RF_DELETION || code === RF_REF_SKIP) {
            emitOp = code === RF_DELETION ? CIGAR_DEL : CIGAR_REF_SKIP
            emitLen = n
            refPos += n
          } else if (code === RF_INSERTION || code === RF_INSERT_BASE) {
            emitOp = CIGAR_INS
            emitLen = n
            readConsumed += n
          } else if (code === RF_SOFT_CLIP) {
            emitOp = CIGAR_SOFT_CLIP
            emitLen = n
            readConsumed += n
          } else if (code === RF_PADDING || code === RF_HARD_CLIP) {
            emitOp = code === RF_PADDING ? CIGAR_PAD : CIGAR_HARD_CLIP
            emitLen = n
          }

          if (emitLen > 0) {
            if (emitOp === op) {
              oplen += emitLen
            } else {
              if (oplen > 0) {
                callback(op, oplen)
              }
              op = emitOp
              oplen = emitLen
            }
          }
        }
      }
    }

    // any read bases past the last feature are trailing matches
    const trailing = this.readLength - readConsumed
    if (trailing > 0) {
      if (op === CIGAR_MATCH) {
        oplen += trailing
      } else {
        if (oplen > 0) {
          callback(op, oplen)
        }
        op = CIGAR_MATCH
        oplen = trailing
      }
    }

    // flush the final run
    if (oplen > 0) {
      callback(op, oplen)
    }
  }

  /**
   * The op and length a read feature contributes, packed as
   * `(length << 4) | op`, or 0 for one that contributes nothing. The single
   * place the feature-code-to-CIGAR-op mapping is written down for the O(1)
   * clip getters; {@link forEachCigarOp} inlines the same mapping because it
   * also has to track reference and read position as it goes.
   */
  private cigarOpOf(index: number) {
    const arena = this.readFeatureArena!
    const code = arena.codes[index]!
    const n = arena.num[index]!
    if (code === RF_SUBST || code === RF_BASE_QUAL) {
      return (1 << 4) | CIGAR_MATCH
    } else if (code === RF_BASES) {
      return (n << 4) | CIGAR_MATCH
    } else if (code === RF_DELETION) {
      return (n << 4) | CIGAR_DEL
    } else if (code === RF_REF_SKIP) {
      return (n << 4) | CIGAR_REF_SKIP
    } else if (code === RF_INSERTION || code === RF_INSERT_BASE) {
      return (n << 4) | CIGAR_INS
    } else if (code === RF_SOFT_CLIP) {
      return (n << 4) | CIGAR_SOFT_CLIP
    } else if (code === RF_PADDING) {
      return (n << 4) | CIGAR_PAD
    } else if (code === RF_HARD_CLIP) {
      return (n << 4) | CIGAR_HARD_CLIP
    }
    return 0
  }

  /**
   * How many bases the **first** CIGAR operation clips, or 0 when it is not a
   * clip. Equivalently `getNumericCigar()[0]`, without the CIGAR.
   *
   * Reads only the features at the start of the record — a clipped read has its
   * clip in the first feature or two — so this is O(1) where walking the CIGAR
   * to look at its first operation is O(operations), and a long read has
   * thousands. Note it reports that one operation and no more: a read whose
   * CIGAR is `5H4S…` clips 5 here, not 9, exactly as reading `[0]` would.
   *
   * See {@link clipLengthAtStartOfRead} in a genome browser for what this is
   * for: placing a read's clipped bases needs this one number and nothing else
   * the CIGAR carries.
   */
  getLeadingClipLength() {
    const arena = this.readFeatureArena
    if (this.isSegmentUnmapped() || arena === undefined) {
      return 0
    }
    const end = this.readFeatureStart + this.readFeatureCount
    let refPos = this.start
    let clipOp = -1
    let total = 0
    for (let i = this.readFeatureStart; i < end; i++) {
      if (!RF_POSITIONAL[arena.codes[i]!]) {
        continue
      }
      // reference bases before this feature are a leading match, so whatever
      // follows can no longer be the first operation
      if (arena.refPos[i]! > refPos) {
        break
      }
      const packed = this.cigarOpOf(i)
      const length = packed >> 4
      if (length === 0) {
        // a zero-length operation is dropped rather than emitted, so it neither
        // starts nor ends the leading run
        continue
      }
      const op = packed & 0xf
      if (clipOp < 0) {
        if (op !== CIGAR_SOFT_CLIP && op !== CIGAR_HARD_CLIP) {
          return 0
        }
        clipOp = op
      } else if (op !== clipOp) {
        // a different operation ends the first run
        break
      }
      // adjacent same-op features merge into one operation, so 5H5H is one 10H
      total += length
      if (op === CIGAR_DEL || op === CIGAR_REF_SKIP) {
        refPos += length
      }
    }
    return total
  }

  /**
   * How many bases the **last** CIGAR operation clips, or 0 when it is not a
   * clip. Equivalently the last element of the CIGAR, without the CIGAR.
   *
   * The companion to {@link getLeadingClipLength}, and O(1) in the same way: a
   * reverse-strand read's clip at the start of the read *as sequenced* is the
   * clip at the end of its alignment, so a genome browser needs both.
   *
   * Whether a trailing clip is really the last *operation* turns on whether any
   * read bases follow it — those become a trailing match, and then the last
   * operation is that M. That is the read bases every earlier operation
   * consumed, which looks like it needs the whole walk. It does not: the walk
   * reaches each feature having emitted exactly `pos[i]` read bases, so the
   * total is `pos[last] + whatever the last feature itself consumes`. Verified
   * against the walk over every record of every fixture plus 628 long reads —
   * ~82,000 records, 13,586 of them trailing-clipped — and pinned by the sweep
   * in `test/getcigar.test.ts`.
   *
   * A record whose `pos` column disagreed with its reference positions could
   * break that identity, but only towards reporting no clip: the guard below
   * returns 0 whenever the accounting says read bases remain.
   */
  getTrailingClipLength() {
    const arena = this.readFeatureArena
    if (this.isSegmentUnmapped() || arena === undefined) {
      return 0
    }
    const start = this.readFeatureStart
    let clipOp = -1
    let total = 0
    let previousRefPos = -1
    for (let i = start + this.readFeatureCount - 1; i >= start; i--) {
      if (!RF_POSITIONAL[arena.codes[i]!]) {
        continue
      }
      const packed = this.cigarOpOf(i)
      const length = packed >> 4
      if (length === 0) {
        // a zero-length operation is dropped rather than emitted
        continue
      }
      const op = packed & 0xf
      if (clipOp < 0) {
        // read bases consumed by everything up to and including this feature;
        // a hard clip consumes none, which is why it is not simply `pos + length`
        const consumesRead =
          op === CIGAR_SOFT_CLIP || op === CIGAR_INS || op === CIGAR_MATCH
        if (arena.pos[i]! + (consumesRead ? length : 0) < this.readLength) {
          // read bases follow, so the last operation is a match, not this
          return 0
        }
        if (op !== CIGAR_SOFT_CLIP && op !== CIGAR_HARD_CLIP) {
          return 0
        }
        clipOp = op
      } else if (op !== clipOp || arena.refPos[i]! !== previousRefPos) {
        // a different operation, or reference bases in between, ends the run
        break
      }
      previousRefPos = arena.refPos[i]!
      // adjacent same-op features merge into one operation, so 5H5H is one 10H
      total += length
    }
    return total
  }

  /**
   * Get the CIGAR string describing this read's alignment against the
   * reference, e.g. `"50M2I48M"`. This is {@link forEachCigarOp} plus a string,
   * so use that instead on any path that does not literally need the text.
   *
   * A mapped record can still have no operations at all — htslib's xx#minimal
   * carries five with a zero read length whose one feature is a zero-length op
   * — and both those and unmapped reads render as `'*'`, which is how SAM
   * spells an absent CIGAR and what samtools prints for them.
   */
  getCigarString(): string {
    let cigar = ''
    this.forEachCigarOp((op, length) => {
      cigar += length + CIGAR_OP_CHARS[op]!
    })
    return cigar || '*'
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
