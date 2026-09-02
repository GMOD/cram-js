import { decodeSliceFromBytes } from './decodeSliceFromBytes.ts'
import { CramArgumentError, CramMalformedError } from '../../errors.ts'
import {
  P_LENGTH_ON_REF,
  SCALAR_STRIDE,
  S_LENGTH_ON_REF,
  S_READ_FEATURE_COUNT,
  S_READ_FEATURE_START,
  S_READ_LENGTH,
  S_SEQUENCE_ID,
  S_START,
} from '../decodedSlice.ts'
import { type CramFileBlock } from '../file.ts'
import { memoizeAsync } from '../memoize.ts'
import { defaultDecodeOptions, resolveSubstitutions } from '../record.ts'
import { getSectionParsers, isMappedSliceHeader } from '../sectionParsers.ts'
import { decodeUtf8, parseItem, sequenceMD5 } from '../util.ts'

import type { BaseOpts, ReadOpts } from '../../opts.ts'
import type CramContainer from '../container/index.ts'
import type DecodedSlice from '../decodedSlice.ts'
import type CramFile from '../file.ts'
import type CramRecord from '../record.ts'
import type { DecodeOptions, RefRegion } from '../record.ts'
import type { SliceDecodeRequest } from './decodeSliceFromBytes.ts'
import type {
  MappedSliceHeader,
  UnmappedSliceHeader,
} from '../sectionParsers.ts'

export { associateIntraSliceMates } from './mateAssociation.ts'

export type SliceHeader = CramFileBlock & {
  parsedContent: MappedSliceHeader | UnmappedSliceHeader
}

/** the slice's bytes, header block first, and where in the file they start */
interface SliceBytes {
  bytes: Uint8Array
  filePosition: number
}

/** a 0-based half-open stretch of one reference */
export interface ReferenceSpan {
  seqId: number
  start: number
  end: number
}

/** reference bases already fetched for one sequence, and which one */
type KnownRegion = RefRegion & { seqId: number }

export default class CramSlice {
  private file: CramFile
  container: CramContainer
  containerPosition: number
  private sliceSize: number | undefined
  private indexSpan: ReferenceSpan | undefined
  // Like `CramContainer`, a slice is constructed per query rather than looked
  // up, so these memos are private to one query and take its signal directly.
  // The decoded slice *is* shared between queries, through
  // `CramFile.featureCache` — `getRecords` below is where that is handled.
  private _bytesMemo = memoizeAsync((opts?: ReadOpts) => this._fetchBytes(opts))
  private _headerMemo = memoizeAsync((opts?: ReadOpts) =>
    this._fetchHeader(opts),
  )
  private _blocksMemo = memoizeAsync((opts?: ReadOpts) =>
    this._fetchBlocks(opts),
  )

  constructor(
    container: CramContainer,
    containerPosition: number,
    sliceSize?: number,
    indexSpan?: ReferenceSpan,
  ) {
    this.file = container.file
    this.container = container
    this.containerPosition = containerPosition
    this.sliceSize = sliceSize
    this.indexSpan = indexSpan
  }

  /**
   * The whole slice — header block and every data block — in one read.
   *
   * One read rather than three: the header used to be probed and re-read by
   * `readBlock` and the blocks fetched separately afterwards. The size is the
   * index's, or the container's landmarks when the slice was reached without
   * one. This is the read a cancellation is really aimed at: under a
   * range-coalescing filehandle a small viewport over deep data turns into a
   * single multi-megabyte request.
   */
  private async _fetchBytes(opts?: ReadOpts): Promise<SliceBytes> {
    const size =
      this.sliceSize ||
      (await this.container.getSliceSize(this.containerPosition, opts))
    const containerHeader = await this.container.getHeader(opts)
    const filePosition = containerHeader._endPosition + this.containerPosition
    return {
      bytes: await this.file.read(size, filePosition, opts),
      filePosition,
    }
  }

  getBytes(opts?: ReadOpts) {
    return this._bytesMemo(opts)
  }

  getHeader(opts?: ReadOpts) {
    return this._headerMemo(opts)
  }

  private async _fetchHeader(opts?: ReadOpts): Promise<SliceHeader> {
    const { majorVersion } = await this.file.getDefinition()
    const sectionParsers = getSectionParsers(majorVersion)
    const containerHeader = await this.container.getHeader(opts)
    const { bytes, filePosition } = await this.getBytes(opts)

    const header = await this.file.readBlockFromBuffer(bytes, 0, filePosition)
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

  /**
   * The slice's data blocks, parsed and decompressed. The decode does not come
   * through here — it takes the raw bytes through `buildDecodeRequest` — so
   * this is only for reaching a block by content id, as an embedded reference
   * is.
   */
  getBlocks(opts?: ReadOpts) {
    return this._blocksMemo(opts)
  }

  private async _fetchBlocks(opts?: ReadOpts) {
    const header = await this.getHeader(opts)
    const { bytes, filePosition } = await this.getBytes(opts)
    const blocks: CramFileBlock[] = new Array(header.parsedContent.numBlocks)
    let bufferOffset = header._endPosition - filePosition
    for (let i = 0; i < blocks.length; i++) {
      const block = await this.file.readBlockFromBuffer(
        bytes,
        bufferOffset,
        filePosition + bufferOffset,
      )
      blocks[i] = block
      bufferOffset = block._endPosition - filePosition
    }
    return blocks
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
    return (await this.getBlocks(opts)).find(
      block => block.contentType === 'EXTERNAL_DATA' && block.contentId === id,
    )
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
          'fetchReferenceSequence callback returned a reference sequence of the wrong length',
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
  ): Promise<KnownRegion | undefined> {
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
          return { seqId: sliceHeader.parsedContent.refSeqId, start, end, seq }
        }
      }
    }
    return undefined
  }

  /**
   * Start fetching the reference for `span` now, ahead of the decode that will
   * need it.
   *
   * The reference read used to be strictly downstream of the decode: the span
   * to ask for was computed from the decoded records, so every slice paid
   * slice read, decode, reference read, resolve in series — and a consumer's
   * sequence source is usually remote. The slice's declared span is known up
   * front, from the `.crai` before the slice is even read, or from its header
   * once it is. Fetching that span overlaps the reference with everything else;
   * `applyReferenceSequence` uses it if it covers what the records turn out to
   * need and falls back to the exact fetch otherwise.
   *
   * Clamped to the reference's length so a span declared past the end of a
   * contig does not fail the fetch, and never rejects: the fetch this replaces
   * is the one whose failure counts, and it still happens if this one fails.
   */
  private async startReferenceFetch(
    span: ReferenceSpan,
    opts?: ReadOpts,
  ): Promise<KnownRegion | undefined> {
    const fetchReferenceSequence = this.file.fetchReferenceSequenceCallback
    if (!fetchReferenceSequence || span.seqId < 0) {
      return undefined
    }
    try {
      const info = (await this.file.getReferenceInfo())[span.seqId]
      const start = Math.max(span.start, 0)
      const end =
        info === undefined ? span.end : Math.min(span.end, info.length)
      if (start >= end) {
        return undefined
      }
      const seq = await fetchReferenceSequence(
        span.seqId,
        start,
        end,
        info?.name,
        opts,
      )
      return seq ? { seqId: span.seqId, start, end, seq } : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Decode each record's base substitutions against the reference, and give the
   * slice the regions its records' bases can later be reconstructed from.
   *
   * Runs **once per slice**, inside the cached decode, rather than once per
   * query: a cached slice re-issuing every `fetchReferenceSequence` call and
   * re-decoding every substitution on each repeat query meant, for jbrowse, a
   * trip to the sequence adapter on every pan back over data it already had.
   *
   * The span asked for is the extent of the slice's reads, never the slice's
   * declared `refSeqSpan` — see `test/seqfetch-bounds.test.ts` and issue #79.
   * Computing it from every record rather than from one query's matches is what
   * makes it a property of the slice, and so cacheable; it is also the widest
   * any sequence of queries against the slice could have asked for in total.
   *
   * The trade, which is the right one but worth knowing: resolving the
   * reference is part of decoding a slice, so a **failed `fetchReferenceSequence`
   * discards the decode too** — `featureCache` drops rejected promises, so a
   * flaky sequence adapter costs a re-decode of the slice on retry where it
   * could cost only the decoration.
   */
  private async applyReferenceSequence(
    slice: DecodedSlice,
    header: MappedSliceHeader,
    known: KnownRegion | undefined,
    opts?: ReadOpts,
  ) {
    const fetchReferenceSequence = this.file.fetchReferenceSequenceCallback
    if (
      !slice.recordCount ||
      // -2 is a multi-reference slice, whose records each name their own
      (header.refSeqId < 0 && header.refSeqId !== -2)
    ) {
      return
    }
    if (!fetchReferenceSequence && !known) {
      return
    }
    const singleRefId = header.refSeqId >= 0 ? header.refSeqId : undefined
    const { scalars, presence, recordCount } = slice

    // the reference span each sequence's reads cover
    const spans = new Map<number, { start: number; end: number }>()
    for (let i = 0; i < recordCount; i++) {
      const o = i * SCALAR_STRIDE
      const seqId = singleRefId ?? scalars[o + S_SEQUENCE_ID]!
      const start = scalars[o + S_START]!
      const lengthOnRef =
        presence[i]! & P_LENGTH_ON_REF ? scalars[o + S_LENGTH_ON_REF]! : 0
      const end = start + (lengthOnRef || scalars[o + S_READ_LENGTH]!)
      const span = spans.get(seqId)
      if (span === undefined) {
        spans.set(seqId, { start, end })
      } else {
        if (start < span.start) {
          span.start = start
        }
        if (end > span.end) {
          span.end = end
        }
      }
    }

    const compressionScheme = await this.getCompressionScheme(opts)
    const resolved = new Map<number, RefRegion>()
    await Promise.all(
      [...spans].map(async ([seqId, span]) => {
        if (seqId === -1 || span.start >= span.end) {
          return
        }
        // the declared span was fetched ahead of the decode, or by the md5
        // check; it covers every mapped read, so it is the fetch in all but
        // the odd file whose records reach outside it
        if (
          known?.seqId === seqId &&
          known.start <= span.start &&
          known.end >= span.end
        ) {
          resolved.set(seqId, known)
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

    const { arena } = slice
    if (arena) {
      for (let i = 0; i < recordCount; i++) {
        const o = i * SCALAR_STRIDE
        const region = resolved.get(singleRefId ?? scalars[o + S_SEQUENCE_ID]!)
        const count = scalars[o + S_READ_FEATURE_COUNT]!
        if (region && count > 0) {
          resolveSubstitutions(
            arena,
            scalars[o + S_READ_FEATURE_START]!,
            count,
            region,
            compressionScheme,
          )
        }
      }
    }
    slice.refRegions = resolved
  }

  /**
   * Everything the decode needs, as bytes and numbers — what a worker can take,
   * and what `decodeSliceFromBytes` takes in-process too.
   *
   * Reads only what the decode reads anyway: the container's header and
   * compression header block, memoized for the query, and the slice's own bytes,
   * already fetched whole by `getBytes`.
   */
  async buildDecodeRequest(
    decodeOptions: Required<DecodeOptions>,
    opts?: ReadOpts,
  ): Promise<SliceDecodeRequest> {
    const { majorVersion } = await this.file.getDefinition()
    const compressionHeaderBlock =
      await this.container.getCompressionHeaderBlock(opts)
    if (!compressionHeaderBlock) {
      throw new CramMalformedError('compression scheme undefined')
    }
    const sliceHeader = await this.getHeader(opts)
    const header = sliceHeader.parsedContent
    if (!isMappedSliceHeader(header)) {
      throw new CramMalformedError('slice header not mapped')
    }
    const { bytes, filePosition } = await this.getBytes(opts)
    const blocksFilePosition = sliceHeader._endPosition

    return {
      majorVersion,
      compressionHeaderContent: compressionHeaderBlock.content,
      compressionHeaderContentPosition: compressionHeaderBlock.contentPosition,
      containerKey: this.container.filePosition,
      sliceBytes: bytes.subarray(blocksFilePosition - filePosition),
      blocksFilePosition,
      numBlocks: header.numBlocks,
      refSeqId: header.refSeqId,
      refSeqStart: header.refSeqStart,
      numRecords: header.numRecords,
      uniqueIdBase: sliceHeader.contentPosition + header.recordCounter + 1,
      decodeTags: decodeOptions.decodeTags,
      validateChecksums: this.file.validateChecksums,
    }
  }

  /**
   * Decode this slice, on the pool where there is one and here otherwise, and
   * decorate it with its reference.
   *
   * The pool resolves undefined rather than throwing for every reason short of
   * a malformed file — no workers in this host, a worker that died carrying the
   * slice, a pool destroyed under it — and each of those means decode it here:
   * a consumer must not lose the ability to read a file because its worker
   * could not launch. A decode error from inside the worker *does* propagate,
   * so a malformed CRAM fails the same way with or without a pool.
   *
   * The reference is applied here either way — `fetchReferenceSequence` is a
   * caller-supplied callback and cannot cross into a worker.
   */
  async _decodeSlice(
    decodeOptions: Required<DecodeOptions>,
    opts?: ReadOpts,
  ): Promise<DecodedSlice> {
    const { majorVersion } = await this.file.getDefinition()
    const checkMd5 = this.file.options.checkSequenceMD5
    // from the index, this starts before the slice's own bytes are read
    const early =
      this.indexSpan && !checkMd5
        ? this.startReferenceFetch(this.indexSpan, opts)
        : undefined
    const sliceHeader = await this.getHeader(opts)
    const header = sliceHeader.parsedContent
    if (!isMappedSliceHeader(header)) {
      throw new CramMalformedError('slice header not mapped')
    }

    // The reference, in flight alongside the decode. The md5 check fetches the
    // same declared span, so with it on that is the fetch; its rejection is
    // observed below, after the decode, and the interim handler only keeps the
    // runtime from reporting it as unhandled in the meantime.
    const reference = checkMd5
      ? this.checkReferenceMd5(sliceHeader, majorVersion, opts)
      : (early ??
        this.startReferenceFetch(
          {
            seqId: header.refSeqId,
            start: header.refSeqStart,
            end: header.refSeqStart + header.refSeqSpan,
          },
          opts,
        ))
    reference.catch(() => undefined)

    const request = await this.buildDecodeRequest(decodeOptions, opts)
    const pool = await this.file.getSliceWorkerPool()
    let slice = pool ? await pool.decodeSlice(request) : undefined
    if (slice === undefined) {
      // The last chance to bail before the expensive part. The decode is
      // synchronous across the whole slice — tens of thousands of records on
      // short-read data — so there is no point inside it at which an abort could
      // be noticed. Checking here also covers the filehandles that ignore the
      // signal outright (`LocalFile`): their reads run to completion regardless,
      // but the decode does not.
      opts?.signal?.throwIfAborted()
      slice = await decodeSliceFromBytes(
        request,
        await this.getCompressionScheme(opts),
      )
    }
    await this.applyReferenceSequence(slice, header, await reference, opts)
    return slice
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
    // survive until every one of them has given up. `featureCache` does
    // that ref-counting and reports this caller's own cancellation to this
    // caller alone.
    //
    // The slice comes back already decorated with its reference — see
    // applyReferenceSequence, which runs once per slice inside the cached
    // decode rather than once per query over the filtered subset.
    const slice = await this.file.featureCache.get(
      cacheKey,
      decodeOptions?.signal,
      signal => this._decodeSlice(opts, { signal }),
    )
    return slice.records(filterFunction, this.file.recordClass)
  }
}
