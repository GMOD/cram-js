import { CramArgumentError, CramMalformedError } from '../../errors.ts'
import Constants from '../constants.ts'
import { buildSliceDecodeContext, trimSliceColumns } from './decodeContext.ts'
import decodeRecord from './decodeRecord.ts'
import { type CramFileBlock } from '../file.ts'
import { memoizeAsync } from '../memoize.ts'
import CramRecord, { defaultDecodeOptions } from '../record.ts'
import { getSectionParsers, isMappedSliceHeader } from '../sectionParsers.ts'
import { decodeUtf8, parseItem, sequenceMD5 } from '../util.ts'

import type { BaseOpts, ReadOpts } from '../../opts.ts'
import type CramContainer from '../container/index.ts'
import type CramFile from '../file.ts'
import type { DecodeOptions } from '../record.ts'
import type {
  MappedSliceHeader,
  UnmappedSliceHeader,
} from '../sectionParsers.ts'

export type SliceHeader = CramFileBlock & {
  parsedContent: MappedSliceHeader | UnmappedSliceHeader
}

/** a reference region whose sequence has been fetched, as addReferenceSequence takes it */
interface RefRegionWithSeq {
  start: number
  end: number
  seq: string
}

/**
 * Try to estimate the template length from a bunch of interrelated
 * multi-segment reads.
 */
function calculateMultiSegmentMatedTemplateLength(
  allRecords: CramRecord[],
  thisRecord: CramRecord,
) {
  const matedRecords: CramRecord[] = [thisRecord]
  let cur = thisRecord
  while (cur.mateRecordNumber !== undefined && cur.mateRecordNumber >= 0) {
    const mateRecord = allRecords[cur.mateRecordNumber]
    if (!mateRecord) {
      throw new CramMalformedError(
        'intra-slice mate record not found, this file seems malformed',
      )
    }
    // A well-formed NF is a forward offset (`NF + recordNumber + 1`), so the
    // chain strictly increases and cannot revisit a record. A malformed one
    // points backwards and the walk never terminates: it re-pushes the same
    // records until the process dies — 14 million entries in two seconds, and
    // synchronously, so the tab cannot even be interrupted. Every record is
    // visited at most once, so overrunning the slice means a cycle.
    if (matedRecords.length > allRecords.length) {
      throw new CramMalformedError(
        'cyclic intra-slice mate chain, this file seems malformed',
      )
    }
    matedRecords.push(mateRecord)
    cur = mateRecord
  }

  let minStart = matedRecords[0]!.start
  let maxEnd = minStart + matedRecords[0]!.readLength
  for (let i = 1; i < matedRecords.length; i++) {
    const r = matedRecords[i]!
    if (r.start < minStart) {
      minStart = r.start
    }
    const end = r.start + r.readLength
    if (end > maxEnd) {
      maxEnd = end
    }
  }
  const estimatedTemplateLength = maxEnd - minStart
  if (estimatedTemplateLength >= 0) {
    matedRecords.forEach(r => {
      if (r.templateLength !== undefined) {
        throw new CramMalformedError(
          'mate pair group has some members that have template lengths already, this file seems malformed',
        )
      }
      // sign per SAM spec: positive for leftmost, negative for rightmost
      r.templateLength =
        r.start === minStart
          ? estimatedTemplateLength
          : -estimatedTemplateLength
    })
  }
}

/**
 * Attempt to calculate the `templateLength` for a pair of intra-slice paired
 * reads. Ported from htslib. Algorithm is imperfect.
 */
function calculateIntraSliceMatePairTemplateLength(
  thisRecord: CramRecord,
  mateRecord: CramRecord,
) {
  // this just estimates the template length by using the simple (non-gapped)
  // end coordinate of each read, because gapping in the alignment doesn't mean
  // the template is longer or shorter
  const start = Math.min(thisRecord.start, mateRecord.start)
  const end = Math.max(
    thisRecord.start + thisRecord.readLength,
    mateRecord.start + mateRecord.readLength,
  )
  const lengthEstimate = end - start
  // sign per SAM spec: positive for leftmost, negative for rightmost
  thisRecord.templateLength =
    thisRecord.start <= mateRecord.start ? lengthEstimate : -lengthEstimate
  mateRecord.templateLength =
    mateRecord.start <= thisRecord.start ? lengthEstimate : -lengthEstimate
}

/**
 * establishes a mate-pair relationship between two records in the same slice.
 * CRAM compresses mate-pair relationships between records in the same slice
 * down into just one record having the index in the slice of its mate
 */
function associateIntraSliceMate(
  allRecords: CramRecord[],
  currentRecordNumber: number,
  thisRecord: CramRecord,
  mateRecord: CramRecord,
) {
  const complicatedMultiSegment = !!(
    mateRecord.mate ||
    (mateRecord.mateRecordNumber !== undefined &&
      mateRecord.mateRecordNumber !== currentRecordNumber)
  )

  // Deal with lossy read names — assign a synthetic name from uniqueId
  // so that paired records share the same name
  if (!thisRecord.readName) {
    const syntheticName = String(thisRecord.uniqueId)
    thisRecord.setSyntheticReadName(syntheticName)
    mateRecord.setSyntheticReadName(syntheticName)
  }

  thisRecord.mate = {
    sequenceId: mateRecord.sequenceId,
    start: mateRecord.start,
    uniqueId: mateRecord.uniqueId,
  }
  if (mateRecord.readName) {
    thisRecord.mate.readName = mateRecord.readName
  }

  // the mate record might have its own mate pointer, if this is some kind of
  // multi-segment (more than paired) scheme, so only relate that one back to this one
  // if it does not have any other relationship
  if (!mateRecord.mate && mateRecord.mateRecordNumber === undefined) {
    mateRecord.mate = {
      sequenceId: thisRecord.sequenceId,
      start: thisRecord.start,
      uniqueId: thisRecord.uniqueId,
    }
    if (thisRecord.readName) {
      mateRecord.mate.readName = thisRecord.readName
    }
  }

  // make sure the proper flags and cramFlags are set on both records
  // paired
  thisRecord.flags |= Constants.BAM_FPAIRED

  // set mate unmapped if needed
  if (mateRecord.flags & Constants.BAM_FUNMAP) {
    thisRecord.flags |= Constants.BAM_FMUNMAP
  }
  if (thisRecord.flags & Constants.BAM_FUNMAP) {
    mateRecord.flags |= Constants.BAM_FMUNMAP
  }

  // set mate reversed if needed
  if (mateRecord.flags & Constants.BAM_FREVERSE) {
    thisRecord.flags |= Constants.BAM_FMREVERSE
  }
  if (thisRecord.flags & Constants.BAM_FREVERSE) {
    mateRecord.flags |= Constants.BAM_FMREVERSE
  }

  if (thisRecord.templateLength === undefined) {
    if (complicatedMultiSegment) {
      calculateMultiSegmentMatedTemplateLength(allRecords, thisRecord)
    } else {
      calculateIntraSliceMatePairTemplateLength(thisRecord, mateRecord)
    }
  }

  // delete this last because it's used by the
  // complicated template length estimation
  thisRecord.mateRecordNumber = undefined
}

/**
 * Interpret the `recordsToNextFragment` attributes the decode left behind, to
 * make standard `mate` objects.
 *
 * The decode loop fills every slot or throws, so `records[i]` is always
 * defined here; the `records[mateRecordNumber]` guard is against a malformed
 * pointer past the end of the slice.
 *
 * Exported for the tests that pin its behaviour on malformed mate pointers;
 * nothing outside the decode calls it.
 */
export function associateIntraSliceMates(records: CramRecord[]) {
  for (let i = 0; i < records.length; i += 1) {
    const r = records[i]!
    const { mateRecordNumber } = r
    if (
      mateRecordNumber !== undefined &&
      mateRecordNumber >= 0 &&
      records[mateRecordNumber]
    ) {
      associateIntraSliceMate(records, i, r, records[mateRecordNumber])
    }
  }
}

export default class CramSlice {
  private file: CramFile
  container: CramContainer
  containerPosition: number
  sliceSize: number
  // Like `CramContainer`, a slice is constructed per query rather than looked
  // up, so these memos are private to one query and take its signal directly.
  // Records decoded out of the slice *are* shared between queries, through
  // `CramFile.featureCache` — `getRecords` below is where that is handled.
  private _headerMemo = memoizeAsync((opts?: ReadOpts) =>
    this._fetchHeader(opts),
  )
  private _blocksMemo = memoizeAsync((opts?: ReadOpts) =>
    this._fetchBlocks(opts),
  )
  private _blocksContentIdIndexMemo = memoizeAsync((opts?: ReadOpts) =>
    this._fetchBlocksContentIdIndex(opts),
  )

  constructor(
    container: CramContainer,
    containerPosition: number,
    sliceSize: number,
  ) {
    this.file = container.file
    this.container = container
    this.containerPosition = containerPosition
    this.sliceSize = sliceSize
  }

  getHeader(opts?: ReadOpts) {
    return this._headerMemo(opts)
  }

  private async _fetchHeader(opts?: ReadOpts) {
    // fetch and parse the slice header
    const { majorVersion } = await this.file.getDefinition()
    const sectionParsers = getSectionParsers(majorVersion)
    const containerHeader = await this.container.getHeader(opts)

    const header = await this.file.readBlock(
      containerHeader._endPosition + this.containerPosition,
      opts,
    )
    const parser =
      header.contentType === 'MAPPED_SLICE_HEADER'
        ? sectionParsers.cramMappedSliceHeader.parser
        : header.contentType === 'UNMAPPED_SLICE_HEADER'
          ? sectionParsers.cramUnmappedSliceHeader.parser
          : undefined
    if (parser) {
      const content = parseItem(
        header.content,
        parser,
        0,
        containerHeader._endPosition,
      )
      return { ...header, parsedContent: content }
    } else {
      throw new CramMalformedError(
        `error reading slice header block, invalid content type ${header.contentType}`,
      )
    }
  }

  getBlocks(opts?: ReadOpts) {
    return this._blocksMemo(opts)
  }

  private async _fetchBlocks(opts?: ReadOpts) {
    const header = await this.getHeader(opts)

    if (this.sliceSize) {
      // if we know the slice size (from the index), do one big read for all
      // blocks and parse from the in-memory buffer
      const containerHeader = await this.container.getHeader(opts)
      const sliceFilePosition =
        containerHeader._endPosition + this.containerPosition
      const blocksFilePosition = header._endPosition
      const headerSize = blocksFilePosition - sliceFilePosition
      const remainingBytes = this.sliceSize - headerSize

      // The read a cancellation is really aimed at. Everything else on this
      // path is header-sized; this is the slice's whole payload, and under a
      // range-coalescing filehandle a small viewport over deep data turns into
      // a single multi-megabyte request.
      const allBlocksBuffer = await this.file.read(
        remainingBytes,
        blocksFilePosition,
        opts,
      )

      const blocks: CramFileBlock[] = new Array(header.parsedContent.numBlocks)
      let bufferOffset = 0
      for (let i = 0; i < blocks.length; i++) {
        const block = await this.file.readBlockFromBuffer(
          allBlocksBuffer,
          bufferOffset,
          blocksFilePosition + bufferOffset,
        )
        blocks[i] = block
        bufferOffset = block._endPosition - blocksFilePosition
      }
      return blocks
    }

    // fallback: read blocks one at a time (non-indexed access)
    let blockPosition = header._endPosition
    const blocks: CramFileBlock[] = new Array(header.parsedContent.numBlocks)
    for (let i = 0; i < blocks.length; i++) {
      const block = await this.file.readBlock(blockPosition, opts)
      blocks[i] = block
      blockPosition = block._endPosition
    }
    return blocks
  }

  // no memoize
  async getCoreDataBlock(opts?: ReadOpts) {
    const blocks = await this.getBlocks(opts)
    return blocks[0]
  }

  _getBlocksContentIdIndex(opts?: ReadOpts) {
    return this._blocksContentIdIndexMemo(opts)
  }

  private async _fetchBlocksContentIdIndex(
    opts?: ReadOpts,
  ): Promise<Record<number, CramFileBlock>> {
    const blocks = await this.getBlocks(opts)
    const blocksByContentId: Record<number, CramFileBlock> = {}
    blocks.forEach(block => {
      if (block.contentType === 'EXTERNAL_DATA') {
        blocksByContentId[block.contentId] = block
      }
    })
    return blocksByContentId
  }

  // the container only lacks a compression scheme when it holds no records,
  // which is never the case for a container we are decoding a slice out of
  private async getCompressionScheme(opts?: ReadOpts) {
    const compressionScheme = await this.container.getCompressionScheme(opts)
    if (compressionScheme === undefined) {
      throw new CramMalformedError('compression scheme undefined')
    }
    return compressionScheme
  }

  async getBlockByContentId(id: number, opts?: ReadOpts) {
    const blocksByContentId = await this._getBlocksContentIdIndex(opts)
    return blocksByContentId[id]
  }

  async getReferenceRegion(opts?: ReadOpts) {
    // read the slice header
    const sliceHeader = (await this.getHeader(opts)).parsedContent
    if (!isMappedSliceHeader(sliceHeader)) {
      throw new Error('slice header not mapped')
    }

    if (sliceHeader.refSeqId < 0) {
      return undefined
    }

    const compressionScheme = await this.getCompressionScheme(opts)

    if (sliceHeader.refBaseBlockId >= 0) {
      const refBlock = await this.getBlockByContentId(
        sliceHeader.refBaseBlockId,
        opts,
      )
      if (!refBlock) {
        throw new CramMalformedError(
          'embedded reference specified, but reference block does not exist',
        )
      }

      // TODO: we do not read anything named 'span'
      // if (sliceHeader.span > refBlock.uncompressedSize) {
      //   throw new CramMalformedError('Embedded reference is too small')
      // }

      // TODO verify
      return {
        seq: decodeUtf8(refBlock.content),
        start: sliceHeader.refSeqStart,
        end: sliceHeader.refSeqStart + sliceHeader.refSeqSpan,
        span: sliceHeader.refSeqSpan,
      }
    }
    if (
      compressionScheme.referenceRequired ||
      this.file.fetchReferenceSequenceCallback
    ) {
      if (!this.file.fetchReferenceSequenceCallback) {
        throw new Error(
          'reference sequence not embedded, and fetchReferenceSequence callback not provided, cannot fetch reference sequence',
        )
      }

      const seq = await this.file.fetchReferenceSequenceCallback(
        sliceHeader.refSeqId,
        sliceHeader.refSeqStart,
        sliceHeader.refSeqStart + sliceHeader.refSeqSpan,
        await this.file.getReferenceName(sliceHeader.refSeqId),
        opts,
      )

      if (seq.length !== sliceHeader.refSeqSpan) {
        throw new CramArgumentError(
          'seqFetch callback returned a reference sequence of the wrong length',
        )
      }

      return {
        seq,
        start: sliceHeader.refSeqStart,
        end: sliceHeader.refSeqStart + sliceHeader.refSeqSpan,
        span: sliceHeader.refSeqSpan,
      }
    }

    return undefined
  }

  getAllRecords(opts?: BaseOpts & DecodeOptions) {
    return this.getRecords(() => true, opts)
  }

  /**
   * Verify the reference the slice was written against matches the one we are
   * decoding with, when the slice records an md5 and the caller asked for the
   * check.
   *
   * Returns the region it fetched, so that decorating the records can reuse it
   * rather than fetching the same bases a second time. It spans the slice's
   * whole declared reference, which by definition covers every mapped read in
   * the slice.
   */
  private async checkReferenceMd5(
    sliceHeader: SliceHeader,
    majorVersion: number,
    opts?: ReadOpts,
  ): Promise<RefRegionWithSeq | undefined> {
    if (
      majorVersion > 1 &&
      this.file.options.checkSequenceMD5 &&
      isMappedSliceHeader(sliceHeader.parsedContent) &&
      sliceHeader.parsedContent.refSeqId >= 0
    ) {
      const md5Bytes = sliceHeader.parsedContent.md5
      // an absent or all-zero md5 means "not recorded", nothing to check
      if (md5Bytes?.some(byte => byte !== 0)) {
        const refRegion = await this.getReferenceRegion(opts)
        if (refRegion) {
          const { seq, start, end } = refRegion
          const seqMd5 = sequenceMD5(seq)
          const storedMd5 = md5Bytes
            .map(byte => (byte < 16 ? '0' : '') + byte.toString(16))
            .join('')
          if (seqMd5 !== storedMd5) {
            throw new CramMalformedError(
              `MD5 checksum reference mismatch for ref ${sliceHeader.parsedContent.refSeqId} pos ${start}..${end}. recorded MD5: ${storedMd5}, calculated MD5: ${seqMd5}`,
            )
          }
          return { start, end, seq }
        }
      }
    }
    return undefined
  }

  /**
   * Decode each record's base substitutions against the reference, and give the
   * records the region their bases can later be reconstructed from.
   *
   * Runs **once per slice**, from `_fetchRecords`, rather than once per query.
   * It used to run in `getRecords` over the filtered records, which meant a
   * cached slice re-issued every `fetchReferenceSequence` call and re-decoded
   * every substitution on each repeat query — for jbrowse, a trip to the
   * sequence adapter for bases it already had on every pan back over data it
   * had already decoded.
   *
   * The span asked for is the extent of the slice's reads, never the slice's
   * declared `refSeqSpan` — see `test/seqfetch-bounds.test.ts` and issue #79.
   * Computing it from every record rather than from one query's matches is what
   * makes it a property of the slice, and so cacheable; it is also the widest
   * any sequence of queries against the slice could have asked for in total.
   */
  private async applyReferenceSequence(
    records: CramRecord[],
    header: MappedSliceHeader,
    md5Region: RefRegionWithSeq | undefined,
    opts?: ReadOpts,
  ) {
    const fetchReferenceSequence = this.file.fetchReferenceSequenceCallback
    if (
      !records.length ||
      // -2 is a multi-reference slice, whose records each name their own
      (header.refSeqId < 0 && header.refSeqId !== -2)
    ) {
      return
    }
    if (!fetchReferenceSequence && !md5Region) {
      return
    }
    const singleRefId = header.refSeqId >= 0 ? header.refSeqId : undefined

    // the reference span each sequence's reads cover
    const spans = new Map<number, { start: number; end: number }>()
    for (const record of records) {
      const seqId = singleRefId ?? record.sequenceId
      const end = record.start + (record.lengthOnRef || record.readLength)
      const span = spans.get(seqId)
      if (span === undefined) {
        spans.set(seqId, { start: record.start, end })
      } else {
        if (record.start < span.start) {
          span.start = record.start
        }
        if (end > span.end) {
          span.end = end
        }
      }
    }

    const compressionScheme = await this.getCompressionScheme(opts)
    const resolved = new Map<number, RefRegionWithSeq>()
    await Promise.all(
      [...spans].map(async ([seqId, span]) => {
        if (seqId === -1 || span.start >= span.end) {
          return
        }
        // the md5 check already fetched the slice's declared reference, which
        // covers every mapped read in it, so reuse rather than fetch again
        if (
          md5Region &&
          md5Region.start <= span.start &&
          md5Region.end >= span.end
        ) {
          resolved.set(seqId, md5Region)
          return
        }
        if (!fetchReferenceSequence) {
          return
        }
        // deliberately NOT length-checked the way getReferenceRegion() is:
        // this span is built from `lengthOnRef || readLength`, so unmapped
        // reads inflate it past the end of the contig and a correct callback
        // legitimately returns fewer bases. Add the check once that span is
        // computed from mapped reads only.
        const seq = await fetchReferenceSequence(
          seqId,
          span.start,
          span.end,
          await this.file.getReferenceName(seqId),
          opts,
        )
        // truthy, not `!== ''`: a callback that cannot resolve the reference
        // may hand back an empty string, and decoding a read against an empty
        // reference throws rather than yielding no bases
        if (seq) {
          resolved.set(seqId, { start: span.start, end: span.end, seq })
        }
      }),
    )

    // The region object is only read, never mutated, so every record covered by
    // one shares it — spreading a copy per record instead cost ~72 bytes of
    // retained heap each.
    for (const record of records) {
      const region = resolved.get(singleRefId ?? record.sequenceId)
      if (region) {
        record.addReferenceSequence(region, compressionScheme)
      }
    }
  }

  async _fetchRecords(
    decodeOptions: Required<DecodeOptions>,
    opts?: ReadOpts,
  ) {
    const { majorVersion } = await this.file.getDefinition()
    const compressionScheme = await this.getCompressionScheme(opts)
    const sliceHeader = await this.getHeader(opts)
    const blocksByContentId = await this._getBlocksContentIdIndex(opts)

    const md5Region = await this.checkReferenceMd5(
      sliceHeader,
      majorVersion,
      opts,
    )

    const header = sliceHeader.parsedContent
    if (!isMappedSliceHeader(header)) {
      throw new CramMalformedError('slice header not mapped')
    }

    const ctx = buildSliceDecodeContext({
      compressionScheme,
      blocksByContentId,
      coreDataBlock: await this.getCoreDataBlock(opts),
      majorVersion,
      refSeqId: header.refSeqId,
      refSeqStart: header.refSeqStart,
      decodeTags: decodeOptions.decodeTags,
    })

    // The last chance to bail before the expensive part. The loop below is
    // synchronous across the whole slice — tens of thousands of records on
    // short-read data — so there is no point inside it at which an abort could
    // be noticed, and no `await` for one to interleave with. Checking here also
    // covers the filehandles that ignore the signal outright (`LocalFile`):
    // their reads run to completion regardless, but the decode does not.
    opts?.signal?.throwIfAborted()

    const records: CramRecord[] = new Array(header.numRecords)
    const uniqueIdBase = sliceHeader.contentPosition + header.recordCounter + 1
    for (let i = 0; i < records.length; i += 1) {
      try {
        records[i] = new CramRecord(decodeRecord(ctx, i, uniqueIdBase + i))
      } catch (e) {
        const err = e as { code?: string; message?: string }
        const error =
          err.code === 'CRAM_BUFFER_OVERRUN'
            ? new CramMalformedError(
                `Failed to decode all records in slice. Decoded ${i} of ${header.numRecords} expected records. ` +
                  `Buffer overrun suggests either: (1) file is truncated/corrupted, (2) compression scheme is incorrect, ` +
                  `or (3) there's a bug in the decoder. Original error: ${err.message}`,
              )
            : e
        throw error
      }
    }

    trimSliceColumns(ctx, records)
    associateIntraSliceMates(records)
    await this.applyReferenceSequence(records, header, md5Region, opts)
    return records
  }

  async getRecords(
    filterFunction: (r: CramRecord) => boolean,
    decodeOptions?: DecodeOptions & BaseOpts,
  ) {
    // Resolve defaults per-key rather than by spreading: callers routinely
    // build a DecodeOptions with explicitly-undefined values (see
    // IndexedCramFile.getRecordsForRange), and a spread would let those
    // undefined values overwrite the defaults.
    const opts: Required<DecodeOptions> = {
      decodeTags: decodeOptions?.decodeTags ?? defaultDecodeOptions.decodeTags,
    }
    // The signal is deliberately *not* part of `opts` above, and so not part of
    // the cache key below: two queries wanting the same records under different
    // signals still want the same records.
    //
    // Include decode options in the cache key so different decode configs are
    // cached separately
    const optionsKey = `${opts.decodeTags ? 1 : 0}`
    const cacheKey = `${this.container.filePosition}:${this.containerPosition}:${optionsKey}`

    // The decode runs under the signal the *cache* hands back, not under this
    // caller's: a slice is shared between concurrent queries, and it must
    // survive until every one of them has given up. `SliceRecordCache` does
    // that ref-counting and reports this caller's own cancellation to this
    // caller alone.
    //
    // The records come back already decorated with their reference — see
    // applyReferenceSequence, which runs once per slice inside the cached
    // decode rather than once per query over the filtered subset.
    const records = await this.file.featureCache.getOrFill(
      cacheKey,
      decodeOptions?.signal,
      signal => this._fetchRecords(opts, { signal }),
    )
    return records.filter(filterFunction)
  }
}
