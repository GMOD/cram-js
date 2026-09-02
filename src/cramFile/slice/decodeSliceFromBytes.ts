/**
 * Decode one slice from its raw bytes, with no `CramFile` in reach.
 *
 * This is the whole of the decode, for the worker and the in-process path
 * alike. Everything it needs arrives as bytes and numbers — see
 * {@link SliceDecodeRequest} — because the things a `CramFile` holds cannot
 * cross a worker boundary: the filehandle, the `fetchReferenceSequence`
 * callback, and the parsed compression scheme (which holds codec instances).
 * The in-process caller hands its own parsed scheme in, since it has one; a
 * worker parses and caches its own.
 *
 * It stops before the reference: the slice comes back undecorated, and
 * `CramSlice` applies the reference on the main thread either way.
 */
import { CramMalformedError } from '../../errors.ts'
import CramContainerCompressionScheme from '../container/compressionScheme.ts'
import DecodedSlice from '../decodedSlice.ts'
import { parseBlockFromBuffer } from '../parseBlock.ts'
import { getSectionParsers } from '../sectionParsers.ts'
import { parseItem } from '../util.ts'
import { buildSliceDecodeContext, trimSliceColumns } from './decodeContext.ts'
import decodeRecord from './decodeRecord.ts'
import { associateIntraSliceMates } from './mateAssociation.ts'

import type { CramFileBlock } from '../file.ts'

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
  /**
   * Where the container starts, which is what the worker-side cache is keyed on.
   *
   * Not on its own an identity: it is a position in *some* file, and the pool is
   * shared by every CRAM in the context. See {@link getScheme}.
   */
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
  /**
   * `sliceHeader.contentPosition + recordCounter + 1` is the first uniqueId.
   * ADR 0011 has why both terms are in there.
   */
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
 * Bounded because a worker lives as long as the page, and the queries this pool
 * is worth the most to — docs/workers.md names a whole-contig scan, an export, a
 * force-load — walk thousands of containers through it. Each entry retains a
 * codec per data series and per tag seen, huffman tables included.
 */
const SCHEME_CACHE_SIZE = 16

/**
 * Parsed compression schemes, by container, most-recently-used last. The header
 * bytes are kept beside each one — see {@link getScheme}.
 *
 * A `Map` iterates in insertion order, so re-inserting on a hit is the whole of
 * the LRU bookkeeping and the oldest key is always the first one.
 */
const schemeCache = new Map<
  number,
  { content: Uint8Array; scheme: CramContainerCompressionScheme }
>()

function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

/**
 * The parsed compression scheme for this request's container.
 *
 * **A hit has to match the header bytes, not just the key.** `containerKey` is a
 * file position, and one pool per JS context serves every CRAM open in it, so
 * two files with a container at the same offset share a key. Not a corner case:
 * files from one pipeline share a SAM header length and so the offset of their
 * first container — `SRR396636` and `SRR396637` in `test/data` both start one at
 * 418. Handing the second file the first's codecs raises `no block found with
 * content ID` there, reporting a good CRAM malformed, and would return wrong
 * records wherever the two schemes happened to be compatible.
 *
 * The bytes are already in the request, so the compare is a pass over 294 B–11.7
 * KB (the fixtures here) against a slice payload of 27 KB–1.5 MB about to be
 * decompressed. It beats minting a file identity: it needs nothing of the caller
 * and stays right when a file is replaced at the same URL.
 */
function getScheme(req: SliceDecodeRequest) {
  const cached = schemeCache.get(req.containerKey)
  if (cached && sameBytes(cached.content, req.compressionHeaderContent)) {
    // re-insert so this key becomes the newest
    schemeCache.delete(req.containerKey)
    schemeCache.set(req.containerKey, cached)
    return cached.scheme
  }

  const sectionParsers = getSectionParsers(req.majorVersion)
  const parsed = parseItem(
    req.compressionHeaderContent,
    sectionParsers.cramCompressionHeader.parser,
    0,
    req.compressionHeaderContentPosition,
  )
  const scheme = new CramContainerCompressionScheme(parsed)

  schemeCache.delete(req.containerKey)
  schemeCache.set(req.containerKey, {
    content: req.compressionHeaderContent,
    scheme,
  })
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
 * Decode the slice `req` describes.
 *
 * The slice comes back **undecorated by the reference** — no
 * {@link DecodedSlice.refRegions}, and no `ref`/`sub` resolved into the arena's
 * substitution columns. That is not an omission: `fetchReferenceSequence` is a
 * caller-supplied callback, so the main thread applies it afterwards.
 *
 * `compressionScheme` is for a caller that already holds the container's parsed
 * scheme; a worker leaves it out and parses through its own cache.
 */
export async function decodeSliceFromBytes(
  req: SliceDecodeRequest,
  compressionScheme = getScheme(req),
): Promise<DecodedSlice> {
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
  const sectionParsers = getSectionParsers(majorVersion)

  // Each block's _endPosition is what locates the next one, so this cannot be
  // parallelised or reordered — the block sizes are only known by walking them.
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

  const blocksByContentId: Record<number, CramFileBlock> = {}
  for (const block of blocks) {
    if (block.contentType === 'EXTERNAL_DATA') {
      blocksByContentId[block.contentId] = block
    }
  }

  const ctx = buildSliceDecodeContext({
    compressionScheme,
    blocksByContentId,
    coreDataBlock: blocks[0],
    majorVersion,
    refSeqId,
    refSeqStart,
    decodeTags,
  })

  const slice = new DecodedSlice(numRecords, ctx.tagColumn)
  for (let i = 0; i < numRecords; i += 1) {
    try {
      decodeRecord(ctx, i, uniqueIdBase + i, slice)
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

  trimSliceColumns(ctx, slice)
  associateIntraSliceMates(slice.records())
  return slice
}
