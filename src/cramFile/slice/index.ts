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

/**
 * Files whose slices embed their reference. The index-span prefetch starts
 * before a slice's header says whether it embeds one, so a file learns it from
 * its first embedded slice and skips the prefetch from then on.
 */
const filesEmbeddingReferences = new WeakSet<object>()

export default class CramSlice<T extends CramRecord = CramRecord> {
  private file: CramFile<T>
  container: CramContainer<T>
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
    container: CramContainer<T>,
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
    if (header.contentType !== 'MAPPED_SLICE_HEADER') {
      throw new CramMalformedError(
        `error reading slice header block, invalid content type ${header.contentType}`,
      )
    }
    const content = parseItem(
      header.content,
      sectionParsers.cramMappedSliceHeader.parser,
      0,
      containerHeader._endPosition,
    )
    return { ...header, parsedContent: content }
  }

  /**
   * The slice's data blocks, parsed and decompressed, for inspecting a slice.
   * Neither the decode nor an embedded reference comes through here: the decode
   * takes the raw bytes through `buildDecodeRequest`, and
   * {@link getBlockByContentId} decompresses only the block it finds.
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

  /**
   * The external block with content id `id`, decompressing only that one: the
   * decode has already decompressed the rest, in a worker or here.
   */
  async getBlockByContentId(id: number, opts?: ReadOpts) {
    const { majorVersion } = await this.file.getDefinition()
    const { cramBlockHeader, cramBlockCrc32 } = getSectionParsers(majorVersion)
    const crcLength = majorVersion >= 3 ? cramBlockCrc32.maxLength : 0
    const header = await this.getHeader(opts)
    const { bytes, filePosition } = await this.getBytes(opts)
    let offset = header._endPosition - filePosition
    for (let i = 0; i < header.parsedContent.numBlocks; i++) {
      const blockHeader = parseItem(
        bytes.subarray(offset, offset + cramBlockHeader.maxLength),
        cramBlockHeader.parser,
      )
      if (
        blockHeader.contentType === 'EXTERNAL_DATA' &&
        blockHeader.contentId === id
      ) {
        return this.file.readBlockFromBuffer(
          bytes,
          offset,
          filePosition + offset,
        )
      }
      offset += blockHeader._size + blockHeader.compressedSize + crcLength
    }
    return undefined
  }

  /**
   * The reference the slice declares, `refSeqSpan` bases from `refSeqStart`:
   * the embedded block when the slice carries one, and otherwise the
   * `fetchReferenceSequence` callback's answer, which has to be exactly that
   * long. Undefined for an unmapped or multi-reference slice.
   */
  async getReferenceRegion(
    opts?: ReadOpts,
  ): Promise<(KnownRegion & { span: number }) | undefined> {
    const sliceHeader = (await this.getHeader(opts)).parsedContent
    if (!isMappedSliceHeader(sliceHeader)) {
      throw new CramMalformedError('slice header not mapped')
    }

    const { refSeqId, refSeqStart, refSeqSpan, refBaseBlockId } = sliceHeader
    if (refSeqId < 0) {
      return undefined
    }
    const region = {
      seqId: refSeqId,
      start: refSeqStart,
      end: refSeqStart + refSeqSpan,
      span: refSeqSpan,
    }

    if (refBaseBlockId >= 0) {
      const refBlock = await this.getBlockByContentId(refBaseBlockId, opts)
      if (!refBlock) {
        throw new CramMalformedError(
          'embedded reference specified, but reference block does not exist',
        )
      }
      if (refBlock.content.length < refSeqSpan) {
        throw new CramMalformedError(
          `embedded reference is ${refBlock.content.length} bases, but the slice spans ${refSeqSpan}`,
        )
      }
      return {
        ...region,
        seq: decodeUtf8(refBlock.content.subarray(0, refSeqSpan)),
      }
    }

    const compressionScheme = await this.getCompressionScheme(opts)
    const fetchReferenceSequence = this.file.fetchReferenceSequenceCallback
    if (!fetchReferenceSequence) {
      if (compressionScheme.referenceRequired) {
        throw new CramArgumentError(
          'reference sequence not embedded, and fetchReferenceSequence callback not provided, cannot fetch reference sequence',
        )
      }
      return undefined
    }

    const seq = await fetchReferenceSequence(
      refSeqId,
      region.start,
      region.end,
      await this.file.getReferenceName(refSeqId),
      opts,
    )
    if (seq.length !== refSeqSpan) {
      throw new CramArgumentError(
        'fetchReferenceSequence callback returned a reference sequence of the wrong length',
      )
    }
    return { ...region, seq }
  }

  getAllRecords(opts?: BaseOpts & DecodeOptions) {
    return this.getRecords(() => true, opts)
  }

  /**
   * Throw unless `region` hashes to the md5 the slice header records for its
   * reference. An absent or all-zero md5 means the writer recorded none.
   */
  private checkReferenceMd5(header: MappedSliceHeader, region: RefRegion) {
    const md5Bytes = header.md5
    if (!md5Bytes?.some(byte => byte !== 0)) {
      return
    }
    const seqMd5 = sequenceMD5(region.seq)
    const storedMd5 = md5Bytes
      .map(byte => (byte < 16 ? '0' : '') + byte.toString(16))
      .join('')
    if (seqMd5 !== storedMd5) {
      throw new CramMalformedError(
        `MD5 checksum reference mismatch for ref ${header.refSeqId} pos ${region.start}..${region.end}. recorded MD5: ${storedMd5}, calculated MD5: ${seqMd5}`,
      )
    }
  }

  /**
   * The reference to decorate this slice's records with, in flight alongside
   * the decode.
   *
   * An embedded reference wins over `fetchReferenceSequence`, as it does in
   * htslib, and needs no callback at all. The md5 check wants the declared span
   * whole, so it reads that too. Anything else is the prefetch of the declared
   * span, started from the index before the slice was read if there was one.
   */
  private async referenceForDecode(
    header: MappedSliceHeader,
    early: Promise<KnownRegion | undefined> | undefined,
    opts?: ReadOpts,
  ): Promise<KnownRegion | undefined> {
    const embedded = header.refSeqId >= 0 && header.refBaseBlockId >= 0
    if (embedded) {
      filesEmbeddingReferences.add(this.file)
    }
    const checkMd5 =
      this.file.options.checkSequenceMD5 &&
      header.refSeqId >= 0 &&
      !!header.md5?.some(byte => byte !== 0)
    if (embedded || checkMd5) {
      const region = await this.getReferenceRegion(opts)
      if (region && checkMd5) {
        this.checkReferenceMd5(header, region)
      }
      return region
    }
    return (
      early ??
      this.startReferenceFetch(
        {
          seqId: header.refSeqId,
          start: header.refSeqStart,
          end: header.refSeqStart + header.refSeqSpan,
        },
        opts,
      )
    )
  }

  /**
   * `[start, end)` of reference `seqId` from `fetchReferenceSequence`, or
   * undefined without a callback or when it hands back an empty string, which
   * is how a callback says it cannot resolve the reference.
   *
   * The request stops at the `@SQ` length, and the answer is padded back out
   * to `end` with N: a read may overhang the end of its contig, and CRAM reads
   * the reference past it as N (CRAMv3 §11). A shorter answer than asked for
   * is padded the same way, so a FASTA that disagrees with the header about a
   * contig's length — chrM is the usual one — costs the bases it lacks rather
   * than the slice. A longer one is a callback on the wrong contract, most
   * likely the pre-v10 1-based closed one, which would shift every base, so it
   * throws.
   */
  private async fetchReference(
    seqId: number,
    start: number,
    end: number,
    opts?: ReadOpts,
  ): Promise<KnownRegion | undefined> {
    const fetchReferenceSequence = this.file.fetchReferenceSequenceCallback
    if (!fetchReferenceSequence) {
      return undefined
    }
    const info = (await this.file.getReferenceInfo())[seqId]
    const from = Math.max(start, 0)
    const to = info === undefined ? end : Math.min(end, info.length)
    if (from >= to) {
      return undefined
    }
    const seq = await fetchReferenceSequence(seqId, from, to, info?.name, opts)
    if (seq.length > to - from) {
      throw new CramArgumentError(
        `fetchReferenceSequence returned ${seq.length} bases for ${from}-${to} of reference ${seqId}, which is ${to - from} bases`,
      )
    }
    return seq
      ? { seqId, start: from, end, seq: seq.padEnd(end - from, 'N') }
      : undefined
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
   * Never rejects: the fetch this replaces is the one whose failure counts, and
   * it still happens if this one fails.
   */
  private async startReferenceFetch(
    span: ReferenceSpan,
    opts?: ReadOpts,
  ): Promise<KnownRegion | undefined> {
    if (span.seqId < 0) {
      return undefined
    }
    try {
      return await this.fetchReference(span.seqId, span.start, span.end, opts)
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
   * The span asked for is the extent of the slice's mapped reads, never the
   * slice's declared `refSeqSpan` — see `test/seqfetch-bounds.test.ts` and issue
   * #79. Computing it from every record rather than from one query's matches is
   * what makes it a property of the slice, and so cacheable; it is also the
   * widest any sequence of queries against the slice could have asked for in
   * total.
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

    // the reference span each sequence's mapped reads cover; an unmapped read
    // stores its bases verbatim and needs none
    const spans = new Map<number, { start: number; end: number }>()
    for (let i = 0; i < recordCount; i++) {
      if (!(presence[i]! & P_LENGTH_ON_REF)) {
        continue
      }
      const o = i * SCALAR_STRIDE
      const seqId = singleRefId ?? scalars[o + S_SEQUENCE_ID]!
      const start = scalars[o + S_START]!
      const end =
        start + (scalars[o + S_LENGTH_ON_REF]! || scalars[o + S_READ_LENGTH]!)
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
        // the declared span came embedded, from the md5 check, or from the
        // fetch ahead of the decode; it covers every mapped read, so it is the
        // reference in all but the odd file whose records reach outside it
        if (
          known?.seqId === seqId &&
          known.start <= span.start &&
          known.end >= span.end
        ) {
          resolved.set(seqId, known)
          return
        }
        const region = await this.fetchReference(
          seqId,
          span.start,
          span.end,
          opts,
        )
        if (region) {
          resolved.set(seqId, region)
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
    // from the index, this starts before the slice's own bytes are read
    const early =
      this.indexSpan &&
      !this.file.options.checkSequenceMD5 &&
      !filesEmbeddingReferences.has(this.file)
        ? this.startReferenceFetch(this.indexSpan, opts)
        : undefined
    const sliceHeader = await this.getHeader(opts)
    const header = sliceHeader.parsedContent
    if (!isMappedSliceHeader(header)) {
      throw new CramMalformedError('slice header not mapped')
    }

    // its rejection is observed after the decode; this handler only keeps the
    // runtime from reporting it as unhandled in the meantime
    const reference = this.referenceForDecode(header, early, opts)
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
    filterFunction: (r: T) => boolean,
    decodeOptions?: DecodeOptions & BaseOpts,
  ) {
    const slice = await this.getDecodedSlice(decodeOptions)
    return slice.records(filterFunction, this.file.recordClass)
  }

  /**
   * The records on `seqId` overlapping the 0-based half-open `[start, end)` —
   * see `DecodedSlice.recordsOverlapping` — without building a view for the
   * records outside it.
   */
  async getRecordsOverlapping(
    seqId: number,
    start: number,
    end: number,
    decodeOptions?: DecodeOptions & BaseOpts,
  ) {
    const slice = await this.getDecodedSlice(decodeOptions)
    return slice.recordsOverlapping(seqId, start, end, this.file.recordClass)
  }

  private getDecodedSlice(decodeOptions?: DecodeOptions & BaseOpts) {
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
    return this.file.featureCache.get(cacheKey, decodeOptions?.signal, signal =>
      this._decodeSlice(opts, { signal }),
    )
  }
}
