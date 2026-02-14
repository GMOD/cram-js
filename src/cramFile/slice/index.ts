import { CramArgumentError, CramMalformedError } from '../../errors.ts'
import { Cursors, DataTypeMapping } from '../codecs/_base.ts'
import { DataSeriesEncodingKey } from '../codecs/dataSeriesTypes.ts'
import { CramBufferOverrunError } from '../codecs/getBits.ts'
import Constants from '../constants.ts'
import decodeRecord, {
  BulkByteRawDecoder,
  DataSeriesDecoder,
} from './decodeRecord.ts'
import ExternalCodec from '../codecs/external.ts'
import { DataSeriesTypes } from '../container/compressionScheme.ts'
import CramContainer from '../container/index.ts'
import CramFile, { CramFileBlock } from '../file.ts'
import CramRecord, { DecodeOptions, defaultDecodeOptions } from '../record.ts'
import {
  MappedSliceHeader,
  UnmappedSliceHeader,
  getSectionParsers,
  isMappedSliceHeader,
} from '../sectionParsers.ts'
import { parseItem, sequenceMD5, tinyMemoize } from '../util.ts'

export type SliceHeader = CramFileBlock & {
  parsedContent: MappedSliceHeader | UnmappedSliceHeader
}

interface RefRegion {
  id: number
  start: number
  end: number
  seq: string | null
}

/**
 * Try to estimate the template length from a bunch of interrelated
 * multi-segment reads.
 */
function calculateMultiSegmentMatedTemplateLength(
  allRecords: CramRecord[],
  _currentRecordNumber: number,
  thisRecord: CramRecord,
) {
  function getAllMatedRecords(startRecord: CramRecord) {
    const records = [startRecord]
    if (
      startRecord.mateRecordNumber !== undefined &&
      startRecord.mateRecordNumber >= 0
    ) {
      const mateRecord = allRecords[startRecord.mateRecordNumber]
      if (!mateRecord) {
        throw new CramMalformedError(
          'intra-slice mate record not found, this file seems malformed',
        )
      }
      records.push(...getAllMatedRecords(mateRecord))
    }
    return records
  }

  const matedRecords = getAllMatedRecords(thisRecord)
  const starts = matedRecords.map(r => r.alignmentStart)
  const ends = matedRecords.map(r => r.alignmentStart + r.readLength - 1)
  const estimatedTemplateLength = Math.max(...ends) - Math.min(...starts) + 1
  if (estimatedTemplateLength >= 0) {
    matedRecords.forEach(r => {
      if (r.templateLength !== undefined) {
        throw new CramMalformedError(
          'mate pair group has some members that have template lengths already, this file seems malformed',
        )
      }
      r.templateLength = estimatedTemplateLength
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
  const start = Math.min(thisRecord.alignmentStart, mateRecord.alignmentStart)
  const end = Math.max(
    thisRecord.alignmentStart + thisRecord.readLength - 1,
    mateRecord.alignmentStart + mateRecord.readLength - 1,
  )
  const lengthEstimate = end - start + 1
  thisRecord.templateLength = lengthEstimate
  mateRecord.templateLength = lengthEstimate
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

  // Deal with lossy read names
  if (!thisRecord.readName) {
    thisRecord.readName = String(thisRecord.uniqueId)
    mateRecord.readName = thisRecord.readName
  }

  thisRecord.mate = {
    sequenceId: mateRecord.sequenceId,
    alignmentStart: mateRecord.alignmentStart,
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
      alignmentStart: thisRecord.alignmentStart,
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
    // thisRecord.templateLength = 0
  }
  if (thisRecord.flags & Constants.BAM_FUNMAP) {
    // thisRecord.templateLength = 0
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
      calculateMultiSegmentMatedTemplateLength(
        allRecords,
        currentRecordNumber,
        thisRecord,
      )
    } else {
      calculateIntraSliceMatePairTemplateLength(thisRecord, mateRecord)
    }
  }

  // delete this last because it's used by the
  // complicated template length estimation
  thisRecord.mateRecordNumber = undefined
}

export default class CramSlice {
  private file: CramFile

  constructor(
    public container: CramContainer,
    public containerPosition: number,
    public sliceSize: number,
  ) {
    this.file = container.file
  }

  // memoize
  async getHeader() {
    // fetch and parse the slice header
    const { majorVersion } = await this.file.getDefinition()
    const sectionParsers = getSectionParsers(majorVersion)
    const containerHeader = await this.container.getHeader()

    const header = await this.file.readBlock(
      containerHeader._endPosition + this.containerPosition,
    )
    if (header.contentType === 'MAPPED_SLICE_HEADER') {
      const content = parseItem(
        header.content,
        sectionParsers.cramMappedSliceHeader.parser,
        0,
        containerHeader._endPosition,
      )
      return { ...header, parsedContent: content }
    } else if (header.contentType === 'UNMAPPED_SLICE_HEADER') {
      const content = parseItem(
        header.content,
        sectionParsers.cramUnmappedSliceHeader.parser,
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

  // memoize
  async getBlocks() {
    const header = await this.getHeader()

    if (this.sliceSize) {
      // if we know the slice size (from the index), do one big read for all
      // blocks and parse from the in-memory buffer
      const containerHeader = await this.container.getHeader()
      const sliceFilePosition =
        containerHeader._endPosition + this.containerPosition
      const blocksFilePosition = header._endPosition
      const headerSize = blocksFilePosition - sliceFilePosition
      const remainingBytes = this.sliceSize - headerSize

      const allBlocksBuffer = await this.file.read(
        remainingBytes,
        blocksFilePosition,
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
      const block = await this.file.readBlock(blockPosition)
      blocks[i] = block
      blockPosition = blocks[i]!._endPosition
    }
    return blocks
  }

  // no memoize
  async getCoreDataBlock() {
    const blocks = await this.getBlocks()
    return blocks[0]!
  }

  // memoize
  async _getBlocksContentIdIndex(): Promise<Record<number, CramFileBlock>> {
    const blocks = await this.getBlocks()
    const blocksByContentId: Record<number, CramFileBlock> = {}
    blocks.forEach(block => {
      if (block.contentType === 'EXTERNAL_DATA') {
        blocksByContentId[block.contentId] = block
      }
    })
    return blocksByContentId
  }

  async getBlockByContentId(id: number) {
    const blocksByContentId = await this._getBlocksContentIdIndex()
    return blocksByContentId[id]
  }

  async getReferenceRegion() {
    // read the slice header
    const decoder = new TextDecoder('utf8')
    const sliceHeader = (await this.getHeader()).parsedContent
    if (!isMappedSliceHeader(sliceHeader)) {
      throw new Error('slice header not mapped')
    }

    if (sliceHeader.refSeqId < 0) {
      return undefined
    }

    const compressionScheme = await this.container.getCompressionScheme()
    if (compressionScheme === undefined) {
      throw new Error('compression scheme undefined')
    }

    if (sliceHeader.refBaseBlockId >= 0) {
      const refBlock = await this.getBlockByContentId(
        sliceHeader.refBaseBlockId,
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
        // @ts-expect-error
        seq: decoder.decode(refBlock.data),
        start: sliceHeader.refSeqStart,
        end: sliceHeader.refSeqStart + sliceHeader.refSeqSpan - 1,
        span: sliceHeader.refSeqSpan,
      }
    }
    if (
      compressionScheme.referenceRequired ||
      this.file.fetchReferenceSequenceCallback
    ) {
      if (!this.file.fetchReferenceSequenceCallback) {
        throw new Error(
          'reference sequence not embedded, and seqFetch callback not provided, cannot fetch reference sequence',
        )
      }

      const seq = await this.file.fetchReferenceSequenceCallback(
        sliceHeader.refSeqId,
        sliceHeader.refSeqStart,
        sliceHeader.refSeqStart + sliceHeader.refSeqSpan - 1,
      )

      if (seq.length !== sliceHeader.refSeqSpan) {
        throw new CramArgumentError(
          'seqFetch callback returned a reference sequence of the wrong length',
        )
      }

      return {
        seq,
        start: sliceHeader.refSeqStart,
        end: sliceHeader.refSeqStart + sliceHeader.refSeqSpan - 1,
        span: sliceHeader.refSeqSpan,
      }
    }

    return undefined
  }

  getAllRecords() {
    return this.getRecords(() => true)
  }

  async _fetchRecords(decodeOptions: Required<DecodeOptions>) {
    const { majorVersion } = await this.file.getDefinition()

    const compressionScheme = await this.container.getCompressionScheme()
    if (compressionScheme === undefined) {
      throw new Error('compression scheme undefined')
    }

    const sliceHeader = await this.getHeader()
    const blocksByContentId = await this._getBlocksContentIdIndex()

    // check MD5 of reference if available
    if (
      majorVersion > 1 &&
      this.file.options.checkSequenceMD5 &&
      isMappedSliceHeader(sliceHeader.parsedContent) &&
      sliceHeader.parsedContent.refSeqId >= 0 &&
      sliceHeader.parsedContent.md5?.join('') !== '0000000000000000'
    ) {
      const refRegion = await this.getReferenceRegion()
      if (refRegion) {
        const { seq, start, end } = refRegion
        const seqMd5 = sequenceMD5(seq)
        const storedMd5 = sliceHeader.parsedContent.md5
          ?.map(byte => (byte < 16 ? '0' : '') + byte.toString(16))
          .join('')
        if (seqMd5 !== storedMd5) {
          throw new CramMalformedError(
            `MD5 checksum reference mismatch for ref ${sliceHeader.parsedContent.refSeqId} pos ${start}..${end}. recorded MD5: ${storedMd5}, calculated MD5: ${seqMd5}`,
          )
        }
      }
    }

    // tracks the read position within the block. codec.decode() methods
    // advance the byte and bit positions in the cursor as they decode
    // data note that we are only decoding a single block here, the core
    // data block
    const coreDataBlock = await this.getCoreDataBlock()
    const cursors: Cursors = {
      lastAlignmentStart: isMappedSliceHeader(sliceHeader.parsedContent)
        ? sliceHeader.parsedContent.refSeqStart
        : 0,
      coreBlock: { bitPosition: 7, bytePosition: 0 },
      externalBlocks: {
        map: new Map(),
        getCursor(contentId: number) {
          let r = this.map.get(contentId)
          if (r === undefined) {
            r = { bitPosition: 7, bytePosition: 0 }
            this.map.set(contentId, r)
          }
          return r
        },
      },
    }

    // Pre-resolve all codecs to avoid repeated lookups
    const codecCache = new Map<DataSeriesEncodingKey, any>()

    const decodeDataSeries: DataSeriesDecoder = <
      T extends DataSeriesEncodingKey,
    >(
      dataSeriesName: T,
    ): DataTypeMapping[DataSeriesTypes[T]] | undefined => {
      let codec = codecCache.get(dataSeriesName)
      if (codec === undefined) {
        codec = compressionScheme.getCodecForDataSeries(dataSeriesName)
        if (!codec) {
          throw new CramMalformedError(
            `no codec defined for ${dataSeriesName} data series`,
          )
        }
        codecCache.set(dataSeriesName, codec)
      }
      return codec.decode(this, coreDataBlock, blocksByContentId, cursors)
    }

    // Create bulk byte decoder for QS and BA data series if they use External codec
    const qsCodec = compressionScheme.getCodecForDataSeries('QS')
    const baCodec = compressionScheme.getCodecForDataSeries('BA')
    const qsIsExternal = qsCodec instanceof ExternalCodec
    const baIsExternal = baCodec instanceof ExternalCodec
    // Create raw byte decoder for QS/BA decoding
    const decodeBulkBytesRaw: BulkByteRawDecoder | undefined =
      qsIsExternal || baIsExternal
        ? (dataSeriesName, length) => {
            if (dataSeriesName === 'QS' && qsIsExternal) {
              return qsCodec.getBytesSubarray(
                blocksByContentId,
                cursors,
                length,
              )
            }
            if (dataSeriesName === 'BA' && baIsExternal) {
              return baCodec.getBytesSubarray(
                blocksByContentId,
                cursors,
                length,
              )
            }
            return undefined
          }
        : undefined

    const records: CramRecord[] = new Array(
      sliceHeader.parsedContent.numRecords,
    )
    for (let i = 0; i < records.length; i += 1) {
      try {
        records[i] = new CramRecord(
          decodeRecord(
            this,
            decodeDataSeries,
            compressionScheme,
            sliceHeader,
            coreDataBlock,
            blocksByContentId,
            cursors,
            majorVersion,
            i,
            sliceHeader.contentPosition +
              sliceHeader.parsedContent.recordCounter +
              i +
              1,
            decodeOptions,
            decodeBulkBytesRaw,
          ),
        )
      } catch (e) {
        if (e instanceof CramBufferOverrunError) {
          const recordsDecoded = i
          const recordsExpected = sliceHeader.parsedContent.numRecords
          throw new CramMalformedError(
            `Failed to decode all records in slice. Decoded ${recordsDecoded} of ${recordsExpected} expected records. ` +
              `Buffer overrun suggests either: (1) file is truncated/corrupted, (2) compression scheme is incorrect, ` +
              `or (3) there's a bug in the decoder. Original error: ${e.message}`,
          )
        } else {
          throw e
        }
      }
    }

    // interpret `recordsToNextFragment` attributes to make standard `mate`
    // objects
    //
    // Resolve mate pair cross-references between records in this slice
    for (let i = 0; i < records.length; i += 1) {
      const r = records[i]
      // check for !!r added after removal  of "stat" file size check: found
      // some undefined entries
      if (r) {
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

    return records
  }

  async getRecords(
    filterFunction: (r: CramRecord) => boolean,
    decodeOptions?: DecodeOptions,
  ) {
    // Merge with defaults
    const opts = { ...defaultDecodeOptions, ...decodeOptions }

    // fetch the features if necessary, using the file-level feature cache
    // Include decode options in cache key so different decode configs are cached separately
    const optionsKey = `${opts.decodeTags ? 1 : 0}`
    const cacheKey = `${this.container.filePosition}:${this.containerPosition}:${optionsKey}`
    let recordsPromise = this.file.featureCache.get(cacheKey)
    if (!recordsPromise) {
      recordsPromise = this._fetchRecords(opts)
      this.file.featureCache.set(cacheKey, recordsPromise)
    }

    const unfiltered = await recordsPromise
    const records = unfiltered.filter(filterFunction)

    // if we can fetch reference sequence, add the reference sequence to the records
    if (records.length && this.file.fetchReferenceSequenceCallback) {
      const sliceHeader = await this.getHeader()
      if (
        isMappedSliceHeader(sliceHeader.parsedContent) &&
        (sliceHeader.parsedContent.refSeqId >= 0 || // single-ref slice
          sliceHeader.parsedContent.refSeqId === -2) // multi-ref slice
      ) {
        const singleRefId =
          sliceHeader.parsedContent.refSeqId >= 0
            ? sliceHeader.parsedContent.refSeqId
            : undefined
        const compressionScheme = await this.container.getCompressionScheme()
        if (compressionScheme === undefined) {
          throw new Error('compression scheme undefined')
        }
        const refRegions: Record<string, RefRegion> = {}

        // iterate over the records to find the spans of the reference
        // sequences we need to fetch
        for (const record of records) {
          const seqId =
            singleRefId !== undefined ? singleRefId : record.sequenceId
          let refRegion = refRegions[seqId]
          if (!refRegion) {
            refRegion = {
              id: seqId,
              start: record.alignmentStart,
              end: Number.NEGATIVE_INFINITY,
              seq: null,
            }
            refRegions[seqId] = refRegion
          }

          const end =
            record.alignmentStart +
            (record.lengthOnRef || record.readLength) -
            1
          if (end > refRegion.end) {
            refRegion.end = end
          }
          if (record.alignmentStart < refRegion.start) {
            refRegion.start = record.alignmentStart
          }
        }

        // fetch the `seq` for all of the ref regions
        await Promise.all(
          Object.values(refRegions).map(async refRegion => {
            if (
              refRegion.id !== -1 &&
              refRegion.start <= refRegion.end &&
              this.file.fetchReferenceSequenceCallback
            ) {
              refRegion.seq = await this.file.fetchReferenceSequenceCallback(
                refRegion.id,
                refRegion.start,
                refRegion.end,
              )
            }
          }),
        )

        // now decorate all the records with them
        for (const record of records) {
          const seqId =
            singleRefId !== undefined ? singleRefId : record.sequenceId
          const refRegion = refRegions[seqId]
          if (refRegion?.seq) {
            const seq = refRegion.seq
            record.addReferenceSequence(
              { ...refRegion, seq },
              compressionScheme,
            )
          }
        }
      }
    }

    return records
  }
}

// memoize several methods in the class for performance
'getHeader getBlocks _getBlocksContentIdIndex'.split(' ').forEach(method => {
  tinyMemoize(CramSlice, method)
})
