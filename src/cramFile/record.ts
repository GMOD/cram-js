import Constants from './constants.ts'
import CramContainerCompressionScheme from './container/compressionScheme.ts'

import type decodeRecord from './slice/decodeRecord.ts'

const textDecoder = new TextDecoder('latin1')

function decodeNullTerminatedString(buffer: Uint8Array) {
  let end = 0
  while (end < buffer.length && buffer[end] !== 0) {
    end++
  }
  return textDecoder.decode(buffer.subarray(0, end))
}

// precomputed pair orientation strings indexed by ((flags >> 4) & 0xF) | (isize > 0 ? 16 : 0)
// bits 0-3 encode flag bits 0x10(reverse),0x20(mate reverse),0x40(read1),0x80(read2)
// bit 4 encodes whether isize > 0
// prettier-ignore
const PAIR_ORIENTATION_TABLE = [
  'F F ','F R ','R F ','R R ','F2F1','F2R1','R2F1','R2R1',
  'F1F2','F1R2','R1F2','R1R2','F2F1','F2R1','R2F1','R2R1',
  'F F ','R F ','F R ','R R ','F1F2','R1F2','F1R2','R1R2',
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
  /** Whether to parse tags. If false, raw tag data is stored for lazy parsing. Default true. */
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

  // remember: all coordinates are 1-based closed
  const regionSeqOffset = cramRecord.alignmentStart - refRegion.start

  if (!cramRecord.readFeatures) {
    return refRegion.seq
      .slice(regionSeqOffset, regionSeqOffset + (cramRecord.lengthOnRef || 0))
      .toUpperCase()
  }

  let bases = ''
  let regionPos = regionSeqOffset
  let currentReadFeature = 0
  while (bases.length < cramRecord.readLength) {
    if (currentReadFeature < cramRecord.readFeatures.length) {
      const feature = cramRecord.readFeatures[currentReadFeature]!
      if (feature.code === 'Q' || feature.code === 'q') {
        currentReadFeature += 1
      } else if (feature.pos === bases.length + 1) {
        // process the read feature
        currentReadFeature += 1

        if (feature.code === 'b') {
          const added = feature.data
          bases += added
          regionPos += added.length
        } else if (feature.code === 'B') {
          bases += feature.data[0]
          regionPos += 1
        } else if (feature.code === 'X') {
          bases += feature.sub
          regionPos += 1
        } else if (feature.code === 'I') {
          bases += feature.data
        } else if (feature.code === 'D') {
          regionPos += feature.data
        } else if (feature.code === 'i') {
          bases += feature.data
        } else if (feature.code === 'N') {
          regionPos += feature.data
        } else if (feature.code === 'S') {
          bases += feature.data
        } else if (feature.code === 'P') {
          // padding, do nothing
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        else if (feature.code === 'H') {
          // hard clip, do nothing
        }
      } else if (currentReadFeature < cramRecord.readFeatures.length) {
        // put down a chunk of sequence up to the next read feature
        const chunk = refRegion.seq.slice(
          regionPos,
          regionPos + feature.pos - bases.length - 1,
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
  }

  return bases.toUpperCase()
}

const baseNumbers = {
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
  cramRecord: CramRecord,
  refRegion: RefRegion,
  compressionScheme: CramContainerCompressionScheme,
  readFeature: ReadFeatureBase & {
    code: 'X'
    data: number
    ref?: string
    sub?: string
  },
) {
  // decode base substitution code using the substitution matrix
  const refCoord = readFeature.refPos - refRegion.start
  const refBase = refRegion.seq.charAt(refCoord)
  if (refBase) {
    readFeature.ref = refBase
  }
  let baseNumber = (baseNumbers as any)[refBase]
  if (baseNumber === undefined) {
    baseNumber = 4
  }
  const substitutionScheme = compressionScheme.substitutionMatrix[baseNumber]!
  const base = substitutionScheme[readFeature.data]
  if (base) {
    readFeature.sub = base
  }
}

export interface MateRecord {
  readName?: string
  sequenceId: number
  alignmentStart: number
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
  const r: any = {}
  for (const [code, name] of x) {
    r[`is${name}`] = (flags: number) => !!(flags & code)
    r[`set${name}`] = (flags: number) => flags | code
  }

  return r
}

export const BamFlagsDecoder = makeFlagsHelper(BamFlags)
export const CramFlagsDecoder = makeFlagsHelper(CramFlags)
export const MateFlagsDecoder = makeFlagsHelper(MateFlags)

/**
 * Class of each CRAM record returned by this API.
 */
export default class CramRecord {
  public tags: Record<string, string>
  public flags: number
  public cramFlags: number
  public readBases?: string | null
  public _refRegion?: RefRegion
  public readFeatures?: ReadFeature[]
  public alignmentStart: number
  public lengthOnRef: number | undefined
  public readLength: number
  public templateLength?: number
  public templateSize?: number
  private _readName?: string
  private _readNameRaw?: Uint8Array
  public mateRecordNumber?: number
  public mate?: MateRecord
  public uniqueId: number
  public sequenceId: number
  public readGroupId: number
  public mappingQuality: number | undefined
  public qualityScores: Uint8Array | null | undefined

  get readName() {
    if (this._readName === undefined && this._readNameRaw) {
      this._readName = decodeNullTerminatedString(this._readNameRaw)
      this._readNameRaw = undefined
    }
    return this._readName
  }

  set readName(val: string | undefined) {
    this._readName = val
    this._readNameRaw = undefined
  }

  constructor({
    flags,
    cramFlags,
    readLength,
    mappingQuality,
    lengthOnRef,
    qualityScores,
    mateRecordNumber,
    readBases,
    readFeatures,
    mateToUse,
    readGroupId,
    readNameRaw,
    sequenceId,
    uniqueId,
    templateSize,
    alignmentStart,
    tags,
  }: ReturnType<typeof decodeRecord>) {
    this.flags = flags
    this.cramFlags = cramFlags
    this.readLength = readLength
    this.mappingQuality = mappingQuality
    this.lengthOnRef = lengthOnRef
    this.qualityScores = qualityScores
    if (readBases) {
      this.readBases = readBases
    }

    this.readGroupId = readGroupId
    this._readNameRaw = readNameRaw
    this.sequenceId = sequenceId!
    this.uniqueId = uniqueId
    this.templateSize = templateSize
    this.alignmentStart = alignmentStart
    this.tags = tags

    // backwards compatibility
    if (readFeatures) {
      this.readFeatures = readFeatures
    }
    if (mateToUse) {
      this.mate = {
        flags: mateToUse.mateFlags,
        readName: mateToUse.mateReadName,
        sequenceId: mateToUse.mateSequenceId,
        alignmentStart: mateToUse.mateAlignmentStart,
      }
    }
    if (mateRecordNumber) {
      this.mateRecordNumber = mateRecordNumber
    }
  }

  /**
   * Get a single quality score at the given index.
   * @param index 0-based index into the quality scores
   * @returns the quality score at that index, or undefined if not available
   */
  qualityScoreAt(index: number): number | undefined {
    return this.qualityScores?.[index]
  }

  /**
   * @returns {boolean} true if the read is paired, regardless of whether both segments are mapped
   */
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

  /** @returns {boolean} true if the read itself is unmapped; conflictive with isProperlyPaired */
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

  /** @returns {boolean} true if this is read number 1 in a pair */
  isRead1() {
    return !!(this.flags & Constants.BAM_FREAD1)
  }

  /** @returns {boolean} true if this is read number 2 in a pair */
  isRead2() {
    return !!(this.flags & Constants.BAM_FREAD2)
  }

  /** @returns {boolean} true if this is a secondary alignment */
  isSecondary() {
    return !!(this.flags & Constants.BAM_FSECONDARY)
  }

  /** @returns {boolean} true if this read has failed QC checks */
  isFailedQc() {
    return !!(this.flags & Constants.BAM_FQCFAIL)
  }

  /** @returns {boolean} true if the read is an optical or PCR duplicate */
  isDuplicate() {
    return !!(this.flags & Constants.BAM_FDUP)
  }

  /** @returns {boolean} true if this is a supplementary alignment */
  isSupplementary() {
    return !!(this.flags & Constants.BAM_FSUPPLEMENTARY)
  }

  /**
   * @returns {boolean} true if the read is detached
   */
  isDetached() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_DETACHED)
  }

  /** @returns {boolean} true if the read has a mate in this same CRAM segment */
  hasMateDownStream() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_MATE_DOWNSTREAM)
  }

  /** @returns {boolean} true if the read contains qual scores */
  isPreservingQualityScores() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_PRESERVE_QUAL_SCORES)
  }

  /** @returns {boolean} true if the read has no sequence bases */
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

  // adapted from igv.js
  // uses precomputed lookup table indexed by flag bits + isize sign
  getPairOrientation() {
    const f = this.flags
    // combined check: paired (0x1) set, unmapped (0x4) clear, mate unmapped (0x8) clear
    if ((f & 0xd) !== 0x1 || this.sequenceId !== this.mate?.sequenceId) {
      return undefined
    }
    const isize = this.templateLength || this.templateSize || 0
    return PAIR_ORIENTATION_TABLE[((f >> 4) & 0xf) | (isize > 0 ? 16 : 0)]
  }

  /**
   * Annotates this feature with the given reference sequence basepair
   * information. This will add a `sub` and a `ref` item to base
   * substitution read features given the actual substituted and reference
   * base pairs, and will make the `getReadSequence()` method work.
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
    if (this.readFeatures) {
      // use the reference bases to decode the bases substituted in each base
      // substitution
      for (const readFeature of this.readFeatures) {
        if (readFeature.code === 'X') {
          decodeBaseSubstitution(
            this,
            refRegion,
            compressionScheme,
            readFeature,
          )
        }
      }
    }

    // if this region completely covers this read,
    // keep a reference to it
    if (
      !this.readBases &&
      refRegion.start <= this.alignmentStart &&
      refRegion.end >=
        this.alignmentStart + (this.lengthOnRef || this.readLength) - 1
    ) {
      this._refRegion = refRegion
    }
  }

  toJSON() {
    const data: any = {}
    Object.keys(this).forEach(k => {
      if (k.startsWith('_')) {
        return
      }
      data[k] = (this as any)[k]
    })

    data.readName = this.readName
    data.readBases = this.getReadBases()
    data.qualityScores = this.qualityScores
      ? Array.from(this.qualityScores)
      : this.qualityScores

    return data
  }
}
