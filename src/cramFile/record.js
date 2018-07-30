const Constants = require('./constants')

function decodeReadSequence(cramRecord, refRegion) {
  // remember: all coordinates are 1-based closed
  const regionSeqOffset = cramRecord.alignmentStart - refRegion.start
  let seqBases = refRegion.seq
    .substr(regionSeqOffset, cramRecord.lengthOnRef)
    .toUpperCase()

  // now go through the read features and mutate the sequence according to them
  if (!cramRecord.readFeatures) return seqBases

  // split the bases into an array so we can munge them more easily
  seqBases = seqBases.split('')

  // go through and apply all the read features to the sequence
  for (let i = 0; i < cramRecord.readFeatures.length; i += 1) {
    const feature = cramRecord.readFeatures[i]
    // 'bqBXIDiQNSPH'
    if (feature.code === 'b') {
      // specify a base pair for some reason
      seqBases[feature.pos - 1] = feature.data
    } else if (feature.code === 'B') {
      // base pair and associated quality
      // TODO: do we need to set the quality in the qual scores?
      seqBases[feature.pos - 1] = feature.data[0]
    } else if (feature.code === 'X') {
      // base substitution
      seqBases[feature.pos - 1] = feature.sub
    } else if (feature.code === 'I') {
      // insertion
      seqBases.splice(feature.pos - 1, 0, ...feature.data.split(''))
    } else if (feature.code === 'D') {
      // deletion
      seqBases.splice(feature.pos - 1, feature.data)
    } else if (feature.code === 'i') {
      // insert single base
      seqBases.splice(feature.pos - 1, feature.data)
    } else if (feature.code === 'N') {
      // reference skip. delete some bases
      seqBases.splice(feature.pos - 1, feature.data)
    } else if (feature.code === 'S') {
      // soft clipped bases that should be present in the read seq
      seqBases.splice(feature.pos - 1, 0, ...feature.data.split(''))
    } else if (feature.code === 'P') {
      // padding, do nothing
    } else if (feature.code === 'H') {
      // hard clip, do nothing
    }
  }
  return seqBases.join('')
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
