const Constants = require('./constants')

function decodeBaseSubstitution(
  cramRecord,
  refRegion,
  compressionScheme,
  readFeature,
) {
  if (!refRegion) return

  // decode base substitution code using the substitution matrix
  const refCoord =
    cramRecord.alignmentStart + readFeature.pos - refRegion.start - 1
  const refBase = refRegion.seq.charAt(refCoord)
  if (refBase) readFeature.ref = refBase
  let baseNumber = {
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
  }[refBase]
  if (baseNumber === undefined) baseNumber = 4
  const substitutionScheme = compressionScheme.substitutionMatrix[baseNumber]
  const base = substitutionScheme[readFeature.data]
  if (base) readFeature.sub = base
}

/**
 * Class of each CRAM record/feature.
 */
class CramRecord {
  constructor() {
    this.tags = {}
  }

  /**
   * the read is paired in sequencing, no matter whether it is mapped in a pair
   */
  isPaired() {
    return !!(this.flags & Constants.BAM_FPAIRED)
  }

  //  the read is mapped in a proper pair
  isProperlyPaired() {
    return !!(this.flags & Constants.BAM_FPROPER_PAIR)
  }

  /** the read itself is unmapped; conflictive with isProperlyPaired */
  isSegmentUnmapped() {
    return !!(this.flags & Constants.BAM_FUNMAP)
  }

  /** the read itself is unmapped; conflictive with isProperlyPaired */
  isMateUnmapped() {
    return !!(this.flags & Constants.BAM_FMUNMAP)
  }

  /** the read is mapped to the reverse strand */
  isReverseComplemented() {
    return !!(this.flags & Constants.BAM_FREVERSE)
  }

  /** the mate is mapped to the reverse strand */
  isMateReverseComplemented() {
    return !!(this.flags & Constants.BAM_FMREVERSE)
  }

  /** */
  isRead1() {
    return !!(this.flags & Constants.BAM_FREAD1)
  }

  /** */
  isRead2() {
    return !!(this.flags & Constants.BAM_FREAD2)
  }

  /** */
  isSecondary() {
    return !!(this.flags & Constants.BAM_FSECONDARY)
  }

  /** */
  isFailedQc() {
    return !!(this.flags & Constants.BAM_FQCFAIL)
  }

  /** optical or PCR duplicate */
  isDuplicate() {
    return !!(this.flags & Constants.BAM_FDUP)
  }

  /** */
  isSupplementary() {
    return !!(this.flags & Constants.BAM_FSUPPLEMENTARY)
  }

  /**
   *
   */
  isDetached() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_DETACHED)
  }

  /** */
  hasMateDownStream() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_MATE_DOWNSTREAM)
  }

  /** */
  isPreservingQualityScores() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_PRESERVE_QUAL_SCORES)
  }

  /** */
  isUnknownBases() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_NO_SEQ)
  }

  lengthOnRef() {
    let lengthOnRef = this.readLength
    if (this.readFeatures)
      this.readFeatures.forEach(({ code, data }) => {
        if (code === 'D' || code === 'N')
          lengthOnRef += data
        else if (code === 'H' || code === 'S')
          lengthOnRef -= data
        else if (code === 'I' || code === 'i')
          lengthOnRef -= data.length
      })

    return lengthOnRef
  }

  /**
   * annotates this feature with the given reference region.
   * right now, this only uses the reference sequence to decode
   * which bases are being substituted in base substitution features.
   * @param {number} refRegion.start
   * @param {number} refRegion.end
   * @param {string} refRegion.seq
   * @param {CramContainerCompressionScheme} compressionScheme
   */
  addReferenceSequence(refRegion, compressionScheme) {
    if (this.readFeatures) {
      // decode the base substituted in a base substitution,
      // if we can fetch the reference sequence
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
  }
}

module.exports = CramRecord
