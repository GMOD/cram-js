const LRU = require('lru-cache')

const { CramUnimplementedError, CramSizeLimitError } = require('./errors')

const CramFile = require('./cramFile')

class IndexedCramFile {
  /**
   *
   * @param {*} args
   * @param {CramFile} args.cram
   * @param {Index-like} args.index object that supports getEntriesForRange(seqId,start,end) -> Promise[Array[index entries]]
   * @param {number} [args.cacheSlices] optional maximum number of CRAM slices to cache. default 5
   * @param {number} [args.fetchSizeLimit] optional maximum number of bytes to fetch in a single getFeaturesForRange call.  Default 3 MiB.
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
      })

    if (!(this.cram instanceof CramFile))
      throw new Error('invalid arguments: no cramfile')

    this.index = args.index
    if (!this.index.getEntriesForRange)
      throw new Error('invalid arguments: not an index')

    const cacheSize = args.cacheSlices === undefined ? 5 : args.cacheSlices
    this.lruCache = LRU({ max: cacheSize })

    this.fetchSizeLimit = args.fetchSizeLimit || 3000000
  }

  /**
   *
   * @param {string|number} seq string or numeric ID of the reference sequence
   * @param {number} start
   * @param {number} end
   */
  async getFeaturesForRange(seq, start, end) {
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
    // console.log(
    //   `fetching ${
    //     slices.length
    //   } slices for ${seq}:${start}..${end}, total size ${totalSize}`,
    // )

    // TODO: do we need to merge or de-duplicate the blocks?

    // fetch all the slices and parse the feature data
    const features = []
    const sliceResults = await Promise.all(
      slices.map(slice => this.getFeaturesInSlice(slice)),
    )
    for (let i = 0; i < sliceResults.length; i += 1) {
      const blockFeatures = sliceResults[i]
      blockFeatures.forEach(feature => {
        if (
          feature.sequenceId === seq &&
          feature.alignmentStart < end &&
          feature.alignmentStart + feature.readLength > start
        )
          features.push(feature)
      })
    }
    return features
  }

  getFeaturesInSlice({ containerStart, sliceStart, sliceBytes }) {
    const cacheKey = `${containerStart}+${sliceStart}`
    const cachedPromise = this.lruCache.get(cacheKey)
    if (cachedPromise) {
      // console.log('cache hit',containerStart,sliceStart)
      return cachedPromise
    }

    // console.log('cache miss',containerStart,sliceStart)

    const container = this.cram.getContainerAtPosition(containerStart)
    const slice = container.getSlice(sliceStart, sliceBytes)
    const freshPromise = slice.getAllFeatures()
    this.lruCache.set(cacheKey, freshPromise)
    return freshPromise
  }

  /**
   *
   * @param {number} seqId
   * @returns {Promise[boolean]} true if the CRAM file contains data for the given
   * reference sequence numerical ID
   */
  hasDataForReferenceSequence(seqId) {
    return this.index.hasDataForReferenceSequence(seqId)
  }
}

module.exports = IndexedCramFile
