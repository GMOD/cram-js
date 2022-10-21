import { CramSizeLimitError, CramUnimplementedError } from './errors'

import CramFile from './cramFile'
import CramRecord from './cramFile/record'
import { SeqFetch } from './cramFile/file'
import { Filehandle } from './cramFile/filehandle'
import { Slice } from './craiIndex'

export type CramFileSource = {
  cramFilehandle?: Filehandle
  cramUrl?: string
  cramPath?: string
}

export type CramIndexLike = {
  getEntriesForRange: (
    seqId: number,
    start: number,
    end: number,
  ) => Promise<Slice[]>
  hasDataForReferenceSequence: (seqId: number) => Promise<boolean>
}

export default class IndexedCramFile {
  public cram: CramFile
  public index: CramIndexLike
  private fetchSizeLimit: number

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
  constructor(
    args: {
      index: CramIndexLike
      fetchSizeLimit?: number
    } & (
      | { cram: CramFile }
      | ({
          cram?: undefined
          seqFetch: SeqFetch
          checkSequenceMD5: boolean
          cacheSize?: number
        } & CramFileSource)
    ),
  ) {
    // { cram, index, seqFetch /* fasta, fastaIndex */ }) {
    if (args.cram) {
      this.cram = args.cram
    } else {
      this.cram = new CramFile({
        url: args.cramUrl,
        path: args.cramPath,
        filehandle: args.cramFilehandle,
        seqFetch: args.seqFetch,
        checkSequenceMD5: args.checkSequenceMD5,
        cacheSize: args.cacheSize,
      })
    }

    if (!(this.cram instanceof CramFile)) {
      throw new Error('invalid arguments: no cramfile')
    }

    this.index = args.index
    if (!this.index.getEntriesForRange) {
      throw new Error('invalid arguments: not an index')
    }

    this.fetchSizeLimit = args.fetchSizeLimit || 3000000
  }

  /**
   *
   * @param {number} seq numeric ID of the reference sequence
   * @param {number} start start of the range of interest. 1-based closed coordinates.
   * @param {number} end end of the range of interest. 1-based closed coordinates.
   * @returns {Promise[Array[CramRecord]]}
   */
  async getRecordsForRange(
    seq: number,
    start: number,
    end: number,
    opts: {
      viewAsPairs?: boolean
      pairAcrossChr?: boolean
      maxInsertSize?: number
    } = {},
  ) {
    opts.viewAsPairs = opts.viewAsPairs || false
    opts.pairAcrossChr = opts.pairAcrossChr || false
    opts.maxInsertSize = opts.maxInsertSize || 200000

    if (typeof seq === 'string') {
      // TODO: support string reference sequence names somehow
      throw new CramUnimplementedError(
        'string sequence names not yet supported',
      )
    }
    const seqId = seq
    const slices = await this.index.getEntriesForRange(seqId, start, end)
    const totalSize = slices.map(s => s.sliceBytes).reduce((a, b) => a + b, 0)
    if (totalSize > this.fetchSizeLimit) {
      throw new CramSizeLimitError(
        `data size of ${totalSize.toLocaleString()} bytes exceeded fetch size limit of ${this.fetchSizeLimit.toLocaleString()} bytes`,
      )
    }

    // TODO: do we need to merge or de-duplicate the blocks?

    // fetch all the slices and parse the feature data
    const filter = (feature: CramRecord) =>
      feature.sequenceId === seq &&
      feature.alignmentStart <= end &&
      feature.lengthOnRef !== undefined &&
      feature.alignmentStart + feature.lengthOnRef - 1 >= start
    const sliceResults = await Promise.all(
      slices.map(slice => this.getRecordsInSlice(slice, filter)),
    )

    let ret: CramRecord[] = Array.prototype.concat(...sliceResults)
    if (opts.viewAsPairs) {
      const readNames: Record<string, number> = {}
      const readIds: Record<string, number> = {}
      for (let i = 0; i < ret.length; i += 1) {
        const name = ret[i].readName
        if (name === undefined) {
          throw new Error()
        }
        const id = ret[i].uniqueId
        if (!readNames[name]) {
          readNames[name] = 0
        }
        readNames[name] += 1
        readIds[id] = 1
      }
      const unmatedPairs: Record<string, boolean> = {}
      Object.entries(readNames).forEach(([k, v]) => {
        if (v === 1) {
          unmatedPairs[k] = true
        }
      })
      const matePromises = []
      for (let i = 0; i < ret.length; i += 1) {
        const cramRecord = ret[i]
        const name = cramRecord.readName
        if (name === undefined) {
          throw new Error()
        }
        if (
          unmatedPairs[name] &&
          cramRecord.mate &&
          (cramRecord.mate.sequenceId === seqId || opts.pairAcrossChr) &&
          Math.abs(cramRecord.alignmentStart - cramRecord.mate.alignmentStart) <
            opts.maxInsertSize
        ) {
          const mateSlices = this.index.getEntriesForRange(
            cramRecord.mate.sequenceId,
            cramRecord.mate.alignmentStart,
            cramRecord.mate.alignmentStart + 1,
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
      const mateFeatPromises: Array<Promise<CramRecord[]>> = []

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
            if (feature.readName === undefined) {
              throw new Error()
            }
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
    {
      containerStart,
      sliceStart,
      sliceBytes,
    }: { containerStart: number; sliceStart: number; sliceBytes: number },
    filterFunction: (r: CramRecord) => boolean,
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
  hasDataForReferenceSequence(seqId: number) {
    return this.index.hasDataForReferenceSequence(seqId)
  }
}
