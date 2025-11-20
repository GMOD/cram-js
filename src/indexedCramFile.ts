import { Slice } from './craiIndex.ts'
import { SeqFetch } from './cramFile/file.ts'
import CramFile from './cramFile/index.ts'
import CramRecord from './cramFile/record.ts'
import { CramUnimplementedError } from './errors.ts'

import type { GenericFilehandle } from 'generic-filehandle2'

export interface CramFileSource {
  cramFilehandle?: GenericFilehandle
  cramUrl?: string
  cramPath?: string
}

export interface CramIndexLike {
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

  /**
   *
   * @param {object} args
   * @param {CramFile} args.cram
   *
   * @param {Index-like} args.index object that supports
   * getEntriesForRange(seqId,start,end) -> Promise[Array[index entries]]
   *
   * @param {number} [args.cacheSize] optional maximum number of CRAM records
   * to cache.  default 20,000
   *
   * @param {boolean} [args.checkSequenceMD5] - default true. if false,
   * disables verifying the MD5 checksum of the reference sequence underlying a
   * slice. In some applications, this check can cause an inconvenient amount
   * (many megabases) of sequences to be fetched.
   */
  constructor(
    args: {
      index: CramIndexLike
    } & (
      | { cram: CramFile }
      | ({
          cram?: undefined
          seqFetch?: SeqFetch
          checkSequenceMD5?: boolean
          cacheSize?: number
        } & CramFileSource)
    ),
  ) {
    this.cram =
      args.cram ??
      new CramFile({
        url: args.cramUrl,
        path: args.cramPath,
        filehandle: args.cramFilehandle,
        seqFetch: args.seqFetch,
        checkSequenceMD5: args.checkSequenceMD5,
        cacheSize: args.cacheSize,
      })

    if (!(this.cram instanceof CramFile)) {
      throw new Error('invalid arguments: no cramfile')
    }

    this.index = args.index
  }

  /**
   *
   * @param seq numeric ID of the reference sequence
   * @param start start of the range of interest. 1-based closed coordinates.
   * @param end end of the range of interest. 1-based closed coordinates.
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

    // fetch all the slices and parse the feature data
    const sliceResults = await Promise.all(
      slices.map(slice =>
        this.getRecordsInSlice(slice, feature => {
          // Check if feature belongs to this sequence
          if (feature.sequenceId !== seq) {
            return false
          }

          // For unmapped reads (lengthOnRef is undefined), they are placed at their
          // mate's position. Include them if that position is within the range.
          if (feature.lengthOnRef === undefined) {
            return (
              feature.alignmentStart >= start && feature.alignmentStart <= end
            )
          }

          // For mapped reads, check if they overlap the requested range
          // Use > instead of >= for start boundary to match samtools behavior
          return (
            feature.alignmentStart <= end &&
            feature.alignmentStart + feature.lengthOnRef - 1 > start
          )
        }),
      ),
    )

    let ret: CramRecord[] = Array.prototype.concat(...sliceResults)
    if (opts.viewAsPairs) {
      const readNames: Record<string, number> = {}
      const readIds: Record<string, number> = {}
      for (const read of ret) {
        const name = read.readName
        if (name === undefined) {
          throw new Error('readName undefined')
        }
        const id = read.uniqueId
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
      for (const cramRecord of ret) {
        const name = cramRecord.readName
        if (name === undefined) {
          throw new Error('readName undefined')
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
      let mateChunks = [] as Slice[]
      for (const block of mateBlocks) {
        mateChunks.push(...block)
      }
      // filter out duplicates
      mateChunks = mateChunks
        .sort((a, b) => a.toString().localeCompare(b.toString()))
        .filter(
          (item, pos, ary) =>
            !pos || item.toString() !== ary[pos - 1]!.toString(),
        )

      const mateRecordPromises = []
      const mateFeatPromises: Promise<CramRecord[]>[] = []
      for (const c of mateChunks) {
        let recordPromise = this.cram.featureCache.get(c.toString())
        if (!recordPromise) {
          recordPromise = this.getRecordsInSlice(c, () => true)
          this.cram.featureCache.set(c.toString(), recordPromise)
        }
        mateRecordPromises.push(recordPromise)
        const featPromise = recordPromise.then(feats => {
          const mateRecs = []
          for (const feature of feats) {
            if (feature.readName === undefined) {
              throw new Error('readName undefined')
            }
            if (unmatedPairs[feature.readName] && !readIds[feature.uniqueId]) {
              mateRecs.push(feature)
            }
          }
          return mateRecs
        })
        mateFeatPromises.push(featPromise)
      }
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
