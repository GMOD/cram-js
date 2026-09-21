import CramFile from './cramFile/index.ts'
import { type DecodeOptions } from './cramFile/record.ts'
import { CramMalformedError } from './errors.ts'

import type { IndexOpts, Slice } from './craiIndex.ts'
import type CramContainer from './cramFile/container/index.ts'
import type { CramFileOptions } from './cramFile/file.ts'
import type CramRecord from './cramFile/record.ts'
import type { BaseOpts } from './opts.ts'
import type { GenericFilehandle } from 'generic-filehandle2'

export interface CramFileSource {
  cramFilehandle?: GenericFilehandle
  cramUrl?: string
  cramPath?: string
}

function requireReadName(record: CramRecord): string {
  const name = record.readName
  if (name === undefined) {
    throw new CramMalformedError('readName undefined')
  }
  return name
}

/** where a slice is, as a `.crai` entry records it */
interface SliceLocation {
  containerStart: number
  sliceStart: number
  sliceBytes: number
  /** where the index says the slice's reads lie; see `CramContainer.getSlice` */
  seqId?: number
  start?: number
  span?: number
}

export interface CramIndexLike {
  getEntriesForRange: (
    seqId: number,
    start: number,
    end: number,
    opts?: IndexOpts,
  ) => Promise<Slice[]>
  hasDataForReferenceSequence: (
    seqId: number,
    opts?: IndexOpts,
  ) => Promise<boolean>
}

export type IndexedCramFileArgs<T extends CramRecord = CramRecord> = {
  index: CramIndexLike
} & (
  | { cram: CramFile<T> }
  | ({ cram?: undefined } & CramFileSource & CramFileOptions<T>)
)

export default class IndexedCramFile<T extends CramRecord = CramRecord> {
  public cram: CramFile<T>
  public index: CramIndexLike

  /**
   * @param args.index an object supporting
   * `getEntriesForRange(seqId, start, end)`, normally a {@link CraiIndex}.
   *
   * @param args.cram a pre-constructed `CramFile`. If omitted, give one of
   * `cramFilehandle` / `cramUrl` / `cramPath` and any of
   * {@link CramFileOptions} — `fetchReferenceSequence`, the cache settings,
   * `useSliceWorkerPool`, and the rest — which are forwarded to the `CramFile`
   * this builds. Those options are documented on {@link CramFileOptions}
   * itself; they used to be re-documented here, next to a constructor that
   * re-listed them, and both copies drifted from the real set.
   */
  constructor(args: IndexedCramFileArgs<T>) {
    if (args.cram) {
      this.cram = args.cram
    } else {
      // Everything that is not the source is forwarded as a group rather than
      // field by field. The field-by-field version is what dropped
      // `useSliceWorkerPool` and `numSliceWorkers` in 13.1.0 — they were
      // documented, and unreachable through this class, which is the only entry
      // point most consumers use. `index` and `cram` come off so what reaches
      // CramFile is exactly its own options.
      const { cramUrl, cramPath, cramFilehandle, index, cram, ...options } =
        args
      this.cram = new CramFile({
        ...options,
        url: cramUrl,
        path: cramPath,
        filehandle: cramFilehandle,
      })
    }

    this.index = args.index
  }

  /**
   * Drops every decoded slice held by the feature cache. For a consumer that
   * knows it is finished with this file — a closed track — rather than waiting
   * out `cacheIdleTimeoutMs`.
   */
  clearFeatureCache() {
    this.cram.clearFeatureCache()
  }

  /**
   *
   * @param seq numeric ID of the reference sequence
   * @param start start of the range of interest. 0-based half-open coordinates.
   * @param end end of the range of interest. 0-based half-open coordinates.
   */
  async getRecordsForRange(
    seq: number,
    start: number,
    end: number,
    opts: {
      viewAsPairs?: boolean
      pairAcrossChr?: boolean
      maxInsertSize?: number
      /**
       * Called as the slices covering the query are fetched and decoded, with
       * cumulative processed bytes and the total to fetch. Reported at slice
       * granularity (one tick per slice, including instant ticks for cached
       * slices) since slice byte sizes are known up front from the index. Lets
       * callers render a determinate progress bar.
       */
      onProgress?: (bytesDownloaded: number, totalBytes?: number) => void
    } & DecodeOptions &
      BaseOpts = {},
  ) {
    const viewAsPairs = opts.viewAsPairs ?? false
    const pairAcrossChr = opts.pairAcrossChr ?? false
    const maxInsertSize = opts.maxInsertSize ?? 200000
    const onProgress = opts.onProgress
    const signal = opts.signal
    signal?.throwIfAborted()

    // the .crai index downloads lazily here on first query; thread onProgress so
    // its download streams under the same bar, ahead of the slice data below
    const slices = await this.index.getEntriesForRange(seq, start, end, {
      onProgress,
      signal,
    })

    let totalBytes = 0
    for (const slice of slices) {
      totalBytes += slice.sliceBytes
    }
    let downloadedBytes = 0
    onProgress?.(0, totalBytes)

    // A CRAM packs several slices per container, so without this every slice of
    // a query re-read its container's header and compression header block: on
    // ce#1000, 149 slices across ~30 containers meant 456 of 1001 filehandle
    // reads were exact duplicates of another read in the same query.
    //
    // Scoped to this one query on purpose, and it must stay that way. A
    // container's memos are threaded with the caller's `signal` on a
    // first-caller-wins basis (see `memoizeAsync`), which is sound only while
    // every caller of one memo is the same query. A file-level container cache
    // would put the first query's signal in charge of a header every later query
    // depends on — the leak `CramFile.featureCache` and `CraiIndex` handle explicitly,
    // reappearing at a third site with nothing to handle it.
    const containers = new Map<number, CramContainer<T>>()

    const sliceResults = await Promise.all(
      slices.map(entry =>
        this.sliceFor(entry, containers)
          // opts is a superset of DecodeOptions; the slice resolves the
          // defaults per key so passing it straight through is safe
          .getRecordsOverlapping(seq, start, end, opts)
          .then(records => {
            downloadedBytes += entry.sliceBytes
            onProgress?.(downloadedBytes, totalBytes)
            return records
          }),
      ),
    )

    let ret: T[] = sliceResults.flat()
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
          cramRecord.hasNextPosition() &&
          (cramRecord.nextSequenceId === seq || pairAcrossChr) &&
          Math.abs(cramRecord.start - cramRecord.nextStart) < maxInsertSize
        ) {
          matePromises.push(
            this.index.getEntriesForRange(
              cramRecord.nextSequenceId,
              cramRecord.nextStart,
              cramRecord.nextStart + 1,
              { signal },
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
        // `opts`, not just the signal: a mate slice decodes under the same
        // options as the rest of the query. `{ signal }` gave the mates tags a
        // caller had declined, and since `decodeTags` is part of the slice cache
        // key, decoded and cached a slice the pass above already had
        this.getRecordsInSlice(c, () => true, opts, containers).then(feats => {
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
      ret = ret.concat(newMateFeats.flat())
    }
    return ret
  }

  getRecordsInSlice(
    entry: SliceLocation,
    filterFunction: (r: T) => boolean,
    decodeOptions?: DecodeOptions & BaseOpts,
    /**
     * Containers already built for the query this call belongs to, so that
     * slices sharing a container share its header reads. Must be scoped to one
     * query — see where `getRecordsForRange` creates it. Omitting it is
     * correct, just one container's worth of re-reading per slice.
     */
    containers?: Map<number, CramContainer<T>>,
  ) {
    return this.sliceFor(entry, containers).getRecords(
      filterFunction,
      decodeOptions,
    )
  }

  private sliceFor(
    {
      containerStart,
      sliceStart,
      sliceBytes,
      seqId,
      start,
      span,
    }: SliceLocation,
    containers?: Map<number, CramContainer<T>>,
  ) {
    let container = containers?.get(containerStart)
    if (!container) {
      container = this.cram.getContainerAtPosition(containerStart)
      containers?.set(containerStart, container)
    }
    return container.getSlice(
      sliceStart,
      sliceBytes,
      seqId === undefined || start === undefined || span === undefined
        ? undefined
        : { seqId, start, end: start + span },
    )
  }

  /**
   *
   * @param {number} seqId
   * @returns {Promise} true if the CRAM file contains data for the given
   * reference sequence numerical ID
   */
  hasDataForReferenceSequence(seqId: number, opts?: IndexOpts) {
    return this.index.hasDataForReferenceSequence(seqId, opts)
  }
}
