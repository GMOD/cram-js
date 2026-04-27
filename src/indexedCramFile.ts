import CramFile from './cramFile/index.ts'
import { type DecodeOptions } from './cramFile/record.ts'
import { CramUnimplementedError } from './errors.ts'

import type { Slice } from './craiIndex.ts'
import type { SeqFetch } from './cramFile/file.ts'
import type CramRecord from './cramFile/record.ts'
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
   * @param {Index-like} args.index object that supports
   * getEntriesForRange(seqId,start,end) -> Promise[Array[index entries]]
   *
   * @param {CramFile} [args.cram] pre-constructed CramFile. If omitted,
   * provide cramPath, cramUrl, or cramFilehandle instead.
   *
   * @param {string} [args.cramPath] local file path to the CRAM file
   * @param {string} [args.cramUrl] remote URL of the CRAM file
   * @param {FileHandle} [args.cramFilehandle] generic-filehandle2 or similar
   *
   * @param {Function} [args.seqFetch] async (seqId, start, end) => string
   * returning reference sequence for a region; seqId is numeric, coords 1-based
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
          validateChecksums?: boolean
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
        validateChecksums: args.validateChecksums,
        cacheSize: args.cacheSize,
      })

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
    } & DecodeOptions = {},
  ) {
    const viewAsPairs = opts.viewAsPairs || false
    const pairAcrossChr = opts.pairAcrossChr || false
    const maxInsertSize = opts.maxInsertSize || 200000
    const decodeOptions: DecodeOptions = {
      decodeTags: opts.decodeTags,
    }

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
        this.getRecordsInSlice(
          slice,
          feature => {
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
          },
          decodeOptions,
        ),
      ),
    )

    const ret: CramRecord[] = sliceResults.flat()
    if (viewAsPairs) {
      const readNameCounts = new Map<string, number>()
      const readIds = new Set<number>()
      for (const read of ret) {
        const name = read.readName
        if (name === undefined) {
          throw new Error('readName undefined')
        }
        readNameCounts.set(name, (readNameCounts.get(name) ?? 0) + 1)
        readIds.add(read.uniqueId)
      }
      const unmatedPairs = new Set<string>()
      for (const [name, count] of readNameCounts) {
        if (count === 1) {
          unmatedPairs.add(name)
        }
      }
      const matePromises = []
      for (const cramRecord of ret) {
        const name = cramRecord.readName
        if (name === undefined) {
          throw new Error('readName undefined')
        }
        if (
          unmatedPairs.has(name) &&
          cramRecord.mate &&
          (cramRecord.mate.sequenceId === seqId || pairAcrossChr) &&
          Math.abs(cramRecord.alignmentStart - cramRecord.mate.alignmentStart) <
            maxInsertSize
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
      let mateChunks: Slice[] = mateBlocks.flat()
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
            if (
              unmatedPairs.has(feature.readName) &&
              !readIds.has(feature.uniqueId)
            ) {
              mateRecs.push(feature)
            }
          }
          return mateRecs
        })
        mateFeatPromises.push(featPromise)
      }
      const newMateFeats = await Promise.all(mateFeatPromises)
      for (const feats of newMateFeats) {
        for (const feat of feats) {
          ret.push(feat)
        }
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
    decodeOptions?: DecodeOptions,
  ) {
    const container = this.cram.getContainerAtPosition(containerStart)
    const slice = container.getSlice(sliceStart, sliceBytes)
    return slice.getRecords(filterFunction, decodeOptions)
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
