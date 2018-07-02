const Constants = require('./constants')

/**
 * Class of each CRAM record/feature.
 */
class CramRecord {
  constructor() {
    this.tags = {}
  }

  /** */
  isSegmentUnmapped() {
    return !!(this.flags & Constants.BAM_FUNMAP)
  }

  /** */
  isReverseComplemented() {
    return !!(this.flags & Constants.BAM_FREVERSE)
  }

  /** */
  isMateReverseComplemented() {
    return !!(this.flags & Constants.BAM_FMREVERSE)
  }

  /**
   * @returns true if the
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
}

module.exports = CramRecord
