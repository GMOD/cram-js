const Constants = require('./constants')

function decodeReadSequence(cramRecord, refRegion) {
  // if it has no length, it has no sequence
  if (!cramRecord.lengthOnRef && !cramRecord.readLength) return undefined

  if (cramRecord.isUnknownBases()) return undefined

  // remember: all coordinates are 1-based closed
  const regionSeqOffset = cramRecord.alignmentStart - refRegion.start

  if (!cramRecord.readFeatures)
    return refRegion.seq
      .substr(regionSeqOffset, cramRecord.lengthOnRef)
      .toUpperCase()

  let bases = ''
  let regionPos = regionSeqOffset
  let currentReadFeature = 0
  while (bases.length < cramRecord.readLength) {
    if (
      currentReadFeature < cramRecord.readFeatures.length &&
      cramRecord.readFeatures[currentReadFeature].pos === bases.length + 1
    ) {
      // process the read feature
      const feature = cramRecord.readFeatures[currentReadFeature]
      currentReadFeature += 1
      if (feature.code === 'b') {
        // specify a base pair for some reason
        bases += feature.data
        regionPos += 1
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
  cramRecord,
  refRegion,
  compressionScheme,
  readFeature,
) {
  if (!refRegion) return

  // decode base substitution code using the substitution matrix
  const refCoord = readFeature.refPos - refRegion.start
  const refBase = refRegion.seq.charAt(refCoord)
  if (refBase) readFeature.ref = refBase
  let baseNumber = baseNumbers[refBase]
  if (baseNumber === undefined) baseNumber = 4
  const substitutionScheme = compressionScheme.substitutionMatrix[baseNumber]
  const base = substitutionScheme[readFeature.data]
  if (base) readFeature.sub = base
}

/**
 * Class of each CRAM record returned by this API.
 */
class CramRecord {
  constructor() {
    this.tags = {}
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
      this.readBases = decodeReadSequence(this, this._refRegion)
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
      let isize = this.templateLength||this.templateSize
      if(this.isRead2() && this.templateLength) {
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
  addReferenceSequence(refRegion, compressionScheme) {
    if (this.readFeatures) {
      // use the reference bases to decode the bases
      // substituted in each base substitution
      this.readFeatures.forEach(readFeature => {
        if (readFeature.code === 'X')
          decodeBaseSubstitution(
            this,
            refRegion,
            compressionScheme,
            readFeature,
          )
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
    const data = {}
    Object.keys(this).forEach(k => {
      if (k.charAt(0) === '_') return
      data[k] = this[k]
    })

    data.readBases = this.getReadBases()

    return data
  }
}

module.exports = CramRecord
