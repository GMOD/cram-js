const { CramUnimplementedError, CramSizeLimitError } = require('../errors')

const CramFile = require('./cramFile')

class IndexedCramFile {
  /**
   *
   * @param {object} args
   * @param {CramFile} args.cram
   * @param {Index-like} args.index object that supports getEntriesForRange(seqId,start,end) -> Promise[Array[index entries]]
   * @param {number} [args.cacheSize] optional maximum number of CRAM records to cache.  default 20,000
   * @param {number} [args.fetchSizeLimit] optional maximum number of bytes to fetch in a single getRecordsForRange call.  Default 3 MiB.
   * @param {boolean} [args.checkSequenceMD5] - default true. if false, disables verifying the MD5
   * checksum of the reference sequence underlying a slice. In some applications, this check can cause an inconvenient amount (many megabases) of sequences to be fetched.
   */
  constructor(args) {
    // { cram, index, seqFetch /* fasta, fastaIndex */ }) {
    if (args.cram) this.cram = args.cram
    else
      this.cram = new CramFile({
        url: args.cramUrl,
        path: args.cramPath,
        filehandle: args.cramFilehandle,
        seqFetch: args.seqFetch,
        checkSequenceMD5: args.checkSequenceMD5,
        cacheSize: args.cacheSize,
      })

    if (!(this.cram instanceof CramFile))
      throw new Error('invalid arguments: no cramfile')

    this.index = args.index
    if (!this.index.getEntriesForRange)
      throw new Error('invalid arguments: not an index')

    this.fetchSizeLimit = args.fetchSizeLimit || 3000000
  }

  /**
   *
   * @param {number} seq numeric ID of the reference sequence
   * @param {number} start start of the range of interest. 1-based closed coordinates.
   * @param {number} end end of the range of interest. 1-based closed coordinates.
   * @returns {Promise[Array[CramRecord]]}
   */
  async getRecordsForRange(seq, start, end) {
    if (typeof seq === 'string')
      // TODO: support string reference sequence names somehow
      throw new CramUnimplementedError(
        'string sequence names not yet supported',
      )
    const seqId = seq
    const slices = await this.index.getEntriesForRange(seqId, start, end)
    const totalSize = slices.map(s => s.sliceBytes).reduce((a, b) => a + b, 0)
    if (totalSize > this.fetchSizeLimit)
      throw new CramSizeLimitError(
        `data size of ${totalSize.toLocaleString()} bytes exceeded fetch size limit of ${this.fetchSizeLimit.toLocaleString()} bytes`,
      )

    // TODO: do we need to merge or de-duplicate the blocks?

    // fetch all the slices and parse the feature data
    const filter = feature =>
      feature.sequenceId === seq &&
      feature.alignmentStart <= end &&
      feature.alignmentStart + feature.lengthOnRef >= start
    const sliceResults = await Promise.all(
      slices.map(slice => this.getRecordsInSlice(slice, filter)),
    )

    return Array.prototype.concat(...sliceResults)
  }

  getRecordsInSlice(
    { containerStart, sliceStart, sliceBytes },
    filterFunction,
  ) {
    const container = this.cram.getContainerAtPosition(containerStart)
    const slice = container.getSlice(sliceStart, sliceBytes)
    return slice.getRecords(filterFunction)
  }

  /**
   *
   * @param {number} seqId
   * @returns {Promise} true if the CRAM file contains data for the given
   * reference sequence numerical ID
   */
  hasDataForReferenceSequence(seqId) {
    return this.index.hasDataForReferenceSequence(seqId)
  }
}

module.exports = IndexedCramFile
