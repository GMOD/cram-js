import CramFile from './cramFile/index.ts'
import { type DecodeOptions } from './cramFile/record.ts'

import type { Slice } from './craiIndex.ts'
import type { SeqFetch } from './cramFile/file.ts'
import type CramRecord from './cramFile/record.ts'
import type { GenericFilehandle } from 'generic-filehandle2'

export interface CramFileSource {
  cramFilehandle?: GenericFilehandle
  cramUrl?: string
  cramPath?: string
}

function requireReadName(record: CramRecord): string {
  const name = record.readName
  if (name === undefined) {
    throw new Error('readName undefined')
  }
  return name
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
    const viewAsPairs = opts.viewAsPairs ?? false
    const pairAcrossChr = opts.pairAcrossChr ?? false
    const maxInsertSize = opts.maxInsertSize ?? 200000
    const decodeOptions: DecodeOptions = {
      decodeTags: opts.decodeTags,
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

    let ret: CramRecord[] = sliceResults.flat()
    if (viewAsPairs) {
      const readNameCounts: Record<string, number> = {}
      const seenUniqueIds = new Set<number>()
      for (const read of ret) {
        const name = requireReadName(read)
        readNameCounts[name] = (readNameCounts[name] ?? 0) + 1
        seenUniqueIds.add(read.uniqueId)
      }
      const unmatedReadNames = new Set(
        Object.keys(readNameCounts).filter(k => readNameCounts[k] === 1),
      )
      const matePromises = []
      for (const cramRecord of ret) {
        const name = requireReadName(cramRecord)
        if (
          unmatedReadNames.has(name) &&
          cramRecord.mate &&
          (cramRecord.mate.sequenceId === seqId || pairAcrossChr) &&
          Math.abs(cramRecord.alignmentStart - cramRecord.mate.alignmentStart) <
            maxInsertSize
        ) {
          matePromises.push(
            this.index.getEntriesForRange(
              cramRecord.mate.sequenceId,
              cramRecord.mate.alignmentStart,
              cramRecord.mate.alignmentStart + 1,
            ),
          )
        }
      }
      const mateBlocks = await Promise.all(matePromises)
      // Dedupe slices by their identifying triple. Earlier this used
      // Slice.toString(), but Slice is a plain interface — every value
      // stringified to "[object Object]", silently collapsing all mate
      // slices to one. slice.getRecords() caches internally, so we don't
      // need our own cache layer here.
      const uniqueMateSlices = new Map<string, Slice>()
      for (const s of mateBlocks.flat()) {
        uniqueMateSlices.set(
          `${s.containerStart}:${s.sliceStart}:${s.sliceBytes}`,
          s,
        )
      }

      const mateFeatPromises = [...uniqueMateSlices.values()].map(c =>
        this.getRecordsInSlice(c, () => true).then(feats => {
          const mateRecs = []
          for (const feature of feats) {
            const name = requireReadName(feature)
            if (
              unmatedReadNames.has(name) &&
              !seenUniqueIds.has(feature.uniqueId)
            ) {
              mateRecs.push(feature)
            }
          }
          return mateRecs
        }),
      )
      const newMateFeats = await Promise.all(mateFeatPromises)
      if (newMateFeats.length) {
        ret = ret.concat(newMateFeats.flat())
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
