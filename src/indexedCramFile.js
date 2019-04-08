const entries = require('object.entries-ponyfill')
const { CramUnimplementedError, CramSizeLimitError } = require('./errors')

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
  async getRecordsForRange(seq, start, end, opts = {}) {
    opts.viewAsPairs = opts.viewAsPairs || false
    opts.pairAcrossChr = opts.pairAcrossChr || false
    opts.maxInsertSize = opts.maxInsertSize || 200000

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
      feature.alignmentStart + feature.lengthOnRef - 1 >= start
    const sliceResults = await Promise.all(
      slices.map(slice => this.getRecordsInSlice(slice, filter)),
    )

    let ret = Array.prototype.concat(...sliceResults)
    if (opts.viewAsPairs) {
      const readNames = {}
      const readIds = {}
      for (let i = 0; i < ret.length; i += 1) {
        const name = ret[i].readName
        const id = ret[i].uniqueId
        if (!readNames[name]) readNames[name] = 0
        readNames[name] += 1
        readIds[id] = 1
      }
      const unmatedPairs = {}
      entries(readNames).forEach(([k, v]) => {
        if (v === 1) unmatedPairs[k] = true
      })
      const matePromises = []
      for (let i = 0; i < ret.length; i += 1) {
        const name = ret[i].readName
        if (
          unmatedPairs[name] &&
          ret[i].mate &&
          (ret[i].mate.sequenceId === seqId || opts.pairAcrossChr) &&
          Math.abs(ret[i].alignmentStart - ret[i].mate.alignmentStart) <
            opts.maxInsertSize
        ) {
          const mateSlices = this.index.getEntriesForRange(
            ret[i].mate.sequenceId,
            ret[i].mate.alignmentStart,
            ret[i].mate.alignmentStart + 1,
          )
          matePromises.push(mateSlices)
        }
      }
      const mateBlocks = await Promise.all(matePromises)
      let mateChunks = []
      for (let i = 0; i < mateBlocks.length; i += 1) {
        mateChunks.push(...mateBlocks[i])
      }
      // filter out duplicates
      mateChunks = mateChunks
        .sort((a, b) => a.toString().localeCompare(b.toString()))
        .filter(
          (item, pos, ary) =>
            !pos || item.toString() !== ary[pos - 1].toString(),
        )

      const mateRecordPromises = []
      const mateFeatPromises = []

      const mateTotalSize = mateChunks
        .map(s => s.sliceBytes)
        .reduce((a, b) => a + b, 0)
      if (mateTotalSize > this.fetchSizeLimit) {
        throw new Error(
          `mate data size of ${mateTotalSize.toLocaleString()} bytes exceeded fetch size limit of ${this.fetchSizeLimit.toLocaleString()} bytes`,
        )
      }

      mateChunks.forEach(c => {
        let recordPromise = this.cram.featureCache.get(c.toString())
        if (!recordPromise) {
          recordPromise = this.getRecordsInSlice(c, () => true)
          this.cram.featureCache.set(c.toString(), recordPromise)
        }
        mateRecordPromises.push(recordPromise)
        const featPromise = recordPromise.then(feats => {
          const mateRecs = []
          for (let i = 0; i < feats.length; i += 1) {
            const feature = feats[i]
            if (unmatedPairs[feature.readName] && !readIds[feature.uniqueId]) {
              mateRecs.push(feature)
            }
          }
          return mateRecs
        })
        mateFeatPromises.push(featPromise)
      })
      const newMateFeats = await Promise.all(mateFeatPromises)
      if (newMateFeats.length) {
        const newMates = newMateFeats.reduce((result, current) =>
          result.concat(current),
        )
        ret = ret.concat(newMates)
      }
    }
    return ret
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
