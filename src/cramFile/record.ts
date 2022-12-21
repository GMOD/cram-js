import Constants from './constants'
import CramContainerCompressionScheme from './container/compressionScheme'
import decodeRecord from './slice/decodeRecord'

export type RefRegion = {
  start: number
  end: number
  seq: string
}

export type ReadFeature = {
  code: string
  pos: number
  refPos: number
  data: any

  ref?: string
  sub?: string
}

function decodeReadSequence(
  cramRecord: CramRecord,
  refRegion: RefRegion,
): string | null {
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
      .substr(regionSeqOffset, cramRecord.lengthOnRef)
      .toUpperCase()
  }

  let bases = ''
  let regionPos = regionSeqOffset
  let currentReadFeature = 0
  while (bases.length < cramRecord.readLength) {
    if (currentReadFeature < cramRecord.readFeatures.length) {
      const feature = cramRecord.readFeatures[currentReadFeature]
      if (feature.code === 'Q' || feature.code === 'q') {
        currentReadFeature += 1
      } else if (feature.pos === bases.length + 1) {
        // process the read feature
        currentReadFeature += 1

        if (feature.code === 'b') {
          // specify a base pair for some reason
          const added = feature.data
          bases += added
          regionPos += added.length
        } else if (feature.code === 'B') {
          // base pair and associated quality
          // TODO: do we need to set the quality in the qual scores?
          bases += feature.data[0]
          regionPos += 1
        } else if (feature.code === 'X') {
          // base substitution
          bases += feature.sub
          regionPos += 1
        } else if (feature.code === 'I') {
          // insertion
          bases += feature.data
        } else if (feature.code === 'D') {
          // deletion
          regionPos += feature.data
        } else if (feature.code === 'i') {
          // insert single base
          bases += feature.data
        } else if (feature.code === 'N') {
          // reference skip. delete some bases
          // do nothing
          // seqBases.splice(feature.pos - 1, feature.data)
          regionPos += feature.data
        } else if (feature.code === 'S') {
          // soft clipped bases that should be present in the read seq
          // seqBases.splice(feature.pos - 1, 0, ...feature.data.split(''))
          bases += feature.data
        } else if (feature.code === 'P') {
          // padding, do nothing
        } else if (feature.code === 'H') {
          // hard clip, do nothing
        }
      } else if (currentReadFeature < cramRecord.readFeatures.length) {
        // put down a chunk of sequence up to the next read feature
        const chunk = refRegion.seq.substr(
          regionPos,
          cramRecord.readFeatures[currentReadFeature].pos - bases.length - 1,
        )
        bases += chunk
        regionPos += chunk.length
      }
    } else {
      // put down a chunk of reference up to the full read length
      const chunk = refRegion.seq.substr(
        regionPos,
        cramRecord.readLength - bases.length,
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
  readFeature: ReadFeature,
) {
  if (!refRegion) {
    return
  }

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
  const substitutionScheme = compressionScheme.substitutionMatrix[baseNumber]
  const base = substitutionScheme[readFeature.data]
  if (base) {
    readFeature.sub = base
  }
}

export type MateRecord = {
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
  x: ReadonlyArray<readonly [number, T]>,
): FlagsDecoder<T> & FlagsEncoder<T> {
  const r: any = {}
  for (const [code, name] of x) {
    r['is' + name] = (flags: number) => !!(flags & code)
    r['set' + name] = (flags: number) => flags | code
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
  public readName?: string
  public mateRecordNumber?: number
  public mate?: MateRecord
  public uniqueId: number
  public sequenceId: number
  public readGroupId: number
  public mappingQuality: number | undefined
  public qualityScores: number[] | null | undefined

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
    readName,
    sequenceId,
    uniqueId,
    templateSize,
    alignmentStart,
    tags,
  }: ReturnType<typeof decodeRecord> & { uniqueId: number }) {
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
    this.readName = readName
    this.sequenceId = sequenceId
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

  /**
   * Get the pair orientation of a paired read. Adapted from igv.js
   * @returns {String} of paired orientatin
   */
  getPairOrientation() {
    if (
      !this.isSegmentUnmapped() &&
      this.isPaired() &&
      !this.isMateUnmapped() &&
      this.mate &&
      this.sequenceId === this.mate.sequenceId
    ) {
      const s1 = this.isReverseComplemented() ? 'R' : 'F'
      const s2 = this.isMateReverseComplemented() ? 'R' : 'F'
      let o1 = ' '
      let o2 = ' '
      if (this.isRead1()) {
        o1 = '1'
        o2 = '2'
      } else if (this.isRead2()) {
        o1 = '2'
        o2 = '1'
      }

      const tmp = []
      let isize = this.templateLength || this.templateSize
      if (isize === undefined) {
        throw new Error('One of templateSize and templateLength must be set')
      }
      if (this.alignmentStart > this.mate.alignmentStart && isize > 0) {
        isize = -isize
      }
      if (isize > 0) {
        tmp[0] = s1
        tmp[1] = o1
        tmp[2] = s2
        tmp[3] = o2
      } else {
        tmp[2] = s1
        tmp[3] = o1
        tmp[0] = s2
        tmp[1] = o2
      }
      return tmp.join('')
    }
    return null
  }

  /**
   * Annotates this feature with the given reference sequence basepair
   * information. This will add a `sub` and a `ref` item to base
   * subsitution read features given the actual substituted and reference
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
      // use the reference bases to decode the bases
      // substituted in each base substitution
      this.readFeatures.forEach(readFeature => {
        if (readFeature.code === 'X') {
          decodeBaseSubstitution(
            this,
            refRegion,
            compressionScheme,
            readFeature,
          )
        }
      })
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
      if (k.charAt(0) === '_') {
        return
      }
      data[k] = (this as any)[k]
    })

    data.readBases = this.getReadBases()

    return data
  }
}
