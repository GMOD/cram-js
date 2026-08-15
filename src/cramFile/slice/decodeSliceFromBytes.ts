/**
 * Decode one slice from its raw bytes, with no `CramFile` in reach.
 *
 * This is the whole of what a worker does. Everything it needs arrives as bytes
 * and numbers — see {@link SliceDecodeRequest} — because the things
 * `CramSlice._fetchRecords` normally reaches for cannot cross a worker boundary:
 * the filehandle, the `fetchReferenceSequence` callback, and the parsed
 * compression scheme (which holds codec instances).
 *
 * It deliberately mirrors `_fetchRecords` step for step rather than sharing code
 * with it. Sharing would mean threading a "am I in a worker" flag through the
 * slice class, and the two halves genuinely differ: this one starts from bytes
 * and stops before the reference, that one starts from a filehandle and finishes
 * the reference off. The steps that must not drift — the block walk, the decode
 * loop's error wrapping, the trim/associate order — are called out below.
 */
import { CramMalformedError } from '../../errors.ts'
import CramContainerCompressionScheme from '../container/compressionScheme.ts'
import { parseBlockFromBuffer } from '../parseBlock.ts'
import CramRecord from '../record.ts'
import { getSectionParsers } from '../sectionParsers.ts'
import { serializeSliceRecords } from '../sliceTransfer.ts'
import { parseItem } from '../util.ts'
import { buildSliceDecodeContext, trimSliceColumns } from './decodeContext.ts'
import decodeRecord from './decodeRecord.ts'
import { associateIntraSliceMates } from './index.ts'

import type { CramFileBlock } from '../file.ts'
import type { SliceTransfer } from '../sliceTransfer.ts'

/**
 * Everything a worker needs to decode one slice. All of it is structured-clonable
 * or transferable.
 */
export interface SliceDecodeRequest {
  majorVersion: number
  /**
   * The container's *decompressed* compression header block content, and the
   * file position it was read from.
   *
   * Sent as bytes rather than as a parsed scheme because the scheme holds codec
   * instances. Parsed once per container and cached by {@link containerKey} —
   * a container holds several slices, and re-parsing it per slice would put the
   * work this pool exists to remove back into the worker.
   */
  compressionHeaderContent: Uint8Array
  compressionHeaderContentPosition: number
  /** identifies the container whose scheme this is, for the worker-side cache */
  containerKey: number

  /** the slice's block region: every block laid end to end, still compressed */
  sliceBytes: Uint8Array
  /** file position of `sliceBytes[0]`, which the block positions are relative to */
  blocksFilePosition: number
  numBlocks: number

  /** from the mapped slice header */
  refSeqId: number
  refSeqStart: number
  numRecords: number
  /** `sliceHeader.contentPosition + recordCounter + 1` is the first uniqueId */
  uniqueIdBase: number

  decodeTags: boolean
  validateChecksums: boolean
}

/**
 * How many parsed compression schemes one worker keeps.
 *
 * The point of the cache is that a container holds several slices, so what has
 * to fit is the containers a pool is working through at one time, not the
 * containers a session visits. Sixteen is far above the first and far below the
 * second.
 *
 * It used to be unbounded, on the reasoning that a worker is asked about "tens,
 * not thousands" of containers. That holds for a pileup and not at all for the
 * queries this pool is worth the most to — docs/WORKERS.md names a whole-contig
 * scan, an export and a force-load, and those walk thousands of containers
 * through a worker that lives as long as the page. Each entry retains a codec
 * per data series and per tag seen, huffman tables included, so the growth was
 * real rather than nominal.
 */
const SCHEME_CACHE_SIZE = 16

/**
 * Parsed compression schemes, by container, most-recently-used last.
 *
 * A `Map` iterates in insertion order, so re-inserting on a hit is the whole of
 * the LRU bookkeeping and the oldest key is always the first one.
 */
const schemeCache = new Map<number, CramContainerCompressionScheme>()

function getScheme(req: SliceDecodeRequest) {
  const cached = schemeCache.get(req.containerKey)
  if (cached) {
    // re-insert so this key becomes the newest
    schemeCache.delete(req.containerKey)
    schemeCache.set(req.containerKey, cached)
    return cached
  }

  const sectionParsers = getSectionParsers(req.majorVersion)
  const parsed = parseItem(
    req.compressionHeaderContent,
    sectionParsers.cramCompressionHeader.parser,
    0,
    req.compressionHeaderContentPosition,
  )
  const scheme = new CramContainerCompressionScheme(parsed)

  schemeCache.set(req.containerKey, scheme)
  if (schemeCache.size > SCHEME_CACHE_SIZE) {
    schemeCache.delete(schemeCache.keys().next().value!)
  }
  return scheme
}

/** Drop the worker's parsed-scheme cache. Exported for the tests. */
export function clearSchemeCache() {
  schemeCache.clear()
}

/** How many schemes are cached. Exported for the tests. */
export function schemeCacheSize() {
  return schemeCache.size
}

/**
 * Decode the slice `req` describes, returning it in wire form.
 *
 * The records come back **undecorated by the reference** — no `_refRegion`, and
 * no `ref`/`sub` resolved into the arena's substitution columns. That is not an
 * omission: `fetchReferenceSequence` is a caller-supplied callback, so the main
 * thread applies it after deserialising. See `sliceTransfer.ts`.
 */
export async function decodeSliceFromBytes(req: SliceDecodeRequest): Promise<{
  payload: SliceTransfer
  transfer: ArrayBuffer[]
}> {
  const {
    majorVersion,
    sliceBytes,
    blocksFilePosition,
    numBlocks,
    refSeqId,
    refSeqStart,
    numRecords,
    uniqueIdBase,
    decodeTags,
    validateChecksums,
  } = req
  const compressionScheme = getScheme(req)
  const sectionParsers = getSectionParsers(majorVersion)

  // SYNC: CramSlice._fetchBlocks' indexed branch. Each block's _endPosition is
  // what locates the next one, so this cannot be parallelised or reordered — the
  // block sizes are only known by walking them.
  const blocks: CramFileBlock[] = new Array(numBlocks)
  let bufferOffset = 0
  for (let i = 0; i < numBlocks; i++) {
    const block = await parseBlockFromBuffer({
      buffer: sliceBytes,
      bufferOffset,
      filePosition: blocksFilePosition + bufferOffset,
      majorVersion,
      sectionParsers,
      validateChecksums,
    })
    blocks[i] = block
    bufferOffset = block._endPosition - blocksFilePosition
  }

  // SYNC: CramSlice._fetchBlocksContentIdIndex and getCoreDataBlock
  const blocksByContentId: Record<number, CramFileBlock> = {}
  for (const block of blocks) {
    if (block.contentType === 'EXTERNAL_DATA') {
      blocksByContentId[block.contentId] = block
    }
  }
  const coreDataBlock = blocks[0]

  const ctx = buildSliceDecodeContext({
    compressionScheme,
    blocksByContentId,
    coreDataBlock,
    majorVersion,
    refSeqId,
    refSeqStart,
    decodeTags,
  })

  // SYNC: _fetchRecords' decode loop, including the buffer-overrun message —
  // a worker-decoded slice must fail the same way an in-process one does, since
  // a malformed file is the case most likely to reach a user through this path.
  const records: CramRecord[] = new Array(numRecords)
  for (let i = 0; i < numRecords; i += 1) {
    try {
      records[i] = new CramRecord(decodeRecord(ctx, i, uniqueIdBase + i))
    } catch (e) {
      const err = e as { code?: string; message?: string }
      throw err.code === 'CRAM_BUFFER_OVERRUN'
        ? new CramMalformedError(
            `Failed to decode all records in slice. Decoded ${i} of ${numRecords} expected records. ` +
              `Buffer overrun suggests either: (1) file is truncated/corrupted, (2) compression scheme is incorrect, ` +
              `or (3) there's a bug in the decoder. Original error: ${err.message}`,
          )
        : e
    }
  }

  trimSliceColumns(ctx, records)
  associateIntraSliceMates(records)
  return serializeSliceRecords(records)
}
