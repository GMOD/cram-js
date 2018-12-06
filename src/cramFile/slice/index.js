const {
  CramMalformedError,
  CramBufferOverrunError,
  CramArgumentError,
} = require('../../errors')
const { parseItem, tinyMemoize, sequenceMD5 } = require('../util')

const Constants = require('../constants')
const decodeRecord = require('./decodeRecord')

/**
 * @private
 * Try to estimate the template length from a bunch of interrelated multi-segment reads.
 * @param {Array[CramRecord]} allRecords
 * @param {number} currentRecordNumber
 * @param {CramRecord} thisRecord
 */
function calculateMultiSegmentMatedTemplateLength(
  allRecords,
  currentRecordNumber,
  thisRecord,
) {
  function getAllMatedRecords(startRecord) {
    const records = [startRecord]
    if (startRecord.mateRecordNumber >= 0) {
      const mateRecord = allRecords[startRecord.mateRecordNumber]
      if (!mateRecord)
        throw new CramMalformedError(
          'intra-slice mate record not found, this file seems malformed',
        )
      records.push(...getAllMatedRecords(mateRecord))
    }
    return records
  }

  const matedRecords = getAllMatedRecords(thisRecord)
  const starts = matedRecords.map(r => r.alignmentStart)
  const ends = matedRecords.map(r => r.alignmentStart + r.readLength - 1)
  const estimatedTemplateLength = Math.max(...ends) - Math.min(...starts) + 1
  if (estimatedTemplateLength >= 0)
    matedRecords.forEach(r => {
      if (r.templateLength !== undefined)
        throw new CramMalformedError(
          'mate pair group has some members that have template lengths already, this file seems malformed',
        )
      r.templateLength = estimatedTemplateLength
    })
}

/**
 * @private
 * Attempt to calculate the `templateLength` for a pair of intra-slice paired reads.
 * Ported from htslib. Algorithm is imperfect.
 * @param {CramRecord} thisRecord
 * @param {CramRecord} mateRecord
 */
function calculateIntraSliceMatePairTemplateLength(thisRecord, mateRecord) {
  // this just estimates the template length by using the simple (non-gapped) end coordinate of each
  // read, because gapping in the alignment doesn't mean the template is longer or shorter
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
 * @private establishes a mate-pair relationship between two records in the same slice.
 * CRAM compresses mate-pair relationships between records in the same slice down into
 * just one record having the index in the slice of its mate
 */
function associateIntraSliceMate(
  allRecords,
  currentRecordNumber,
  thisRecord,
  mateRecord,
) {
  if (!mateRecord)
    throw new CramMalformedError(
      'could not resolve intra-slice mate pairs, file seems truncated or malformed',
    )

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
  if (mateRecord.readName) thisRecord.mate.readName = mateRecord.readName

  // the mate record might have its own mate pointer, if this is some kind of
  // multi-segment (more than paired) scheme, so only relate that one back to this one
  // if it does not have any other relationship
  if (!mateRecord.mate && mateRecord.mateRecordNumber === undefined) {
    mateRecord.mate = {
      sequenceId: thisRecord.sequenceId,
      alignmentStart: thisRecord.alignmentStart,
      uniqueId: thisRecord.uniqueId,
    }
    if (thisRecord.readName) mateRecord.mate.readName = thisRecord.readName
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
    if (complicatedMultiSegment)
      calculateMultiSegmentMatedTemplateLength(
        allRecords,
        currentRecordNumber,
        thisRecord,
      )
    else calculateIntraSliceMatePairTemplateLength(thisRecord, mateRecord)
  }

  // delete this last because it's used by the
  // complicated template length estimation
  delete thisRecord.mateRecordNumber
}

class CramSlice {
  constructor(container, position) {
    this.container = container
    this.file = container.file
    this.containerPosition = position
  }

  // memoize
  async getHeader() {
    // fetch and parse the slice header
    const sectionParsers = await this.file.getSectionParsers()
    const containerHeader = await this.container.getHeader()
    const header = await this.file.readBlock(
      containerHeader._endPosition + this.containerPosition,
    )
    if (header.contentType === 'MAPPED_SLICE_HEADER') {
      header.content = parseItem(
        header.content,
        sectionParsers.cramMappedSliceHeader.parser,
        0,
        containerHeader._endPosition,
      )
    } else if (header.contentType === 'UNMAPPED_SLICE_HEADER') {
      header.content = parseItem(
        header.content,
        sectionParsers.cramUnmappedSliceHeader.parser,
        0,
        containerHeader._endPosition,
      )
    } else {
      throw new CramMalformedError(
        `error reading slice header block, invalid content type ${
          header._contentType
        }`,
      )
    }
    return header
  }

  // memoize
  async getBlocks() {
    const header = await this.getHeader()
    // read all the blocks into memory and store them
    let blockPosition = header._endPosition
    const blocks = new Array(header.content.numBlocks)
    for (let i = 0; i < blocks.length; i += 1) {
      blocks[i] = await this.file.readBlock(blockPosition)
      blockPosition = blocks[i]._endPosition
    }

    return blocks
  }

  // no memoize
  async getCoreDataBlock() {
    const blocks = await this.getBlocks()
    // the core data block is always the first block in the slice
    return blocks[0]
  }

  // memoize
  async _getBlocksContentIdIndex() {
    const blocks = await this.getBlocks()
    const blocksByContentId = {}
    blocks.forEach(block => {
      if (block.contentType === 'EXTERNAL_DATA') {
        blocksByContentId[block.contentId] = block
      }
    })
    return blocksByContentId
  }

  async getBlockByContentId(id) {
    const blocksByContentId = await this._getBlocksContentIdIndex()
    return blocksByContentId[id]
  }

  async getReferenceRegion() {
    // read the slice header
    const sliceHeader = (await this.getHeader()).content

    if (sliceHeader.refSeqId < 0) return undefined

    const compressionScheme = await this.container.getCompressionScheme()

    // console.log(JSON.stringify(sliceHeader, null, '  '))

    if (sliceHeader.refBaseBlockId >= 0) {
      const refBlock = this.getBlockByContentId(sliceHeader.refBaseBlockId)
      if (!refBlock)
        throw new CramMalformedError(
          'embedded reference specified, but reference block does not exist',
        )

      if (sliceHeader.span > refBlock.uncompressedSize) {
        throw new CramMalformedError('Embedded reference is too small')
      }

      return {
        seq: refBlock.data.toString('utf8'),
        start: sliceHeader.refSeqStart,
        end: sliceHeader.refSeqStart + sliceHeader.refSeqSpan - 1,
        span: sliceHeader.refSeqSpan,
      }
    } else if (
      compressionScheme.referenceRequired ||
      this.file.fetchReferenceSequenceCallback
    ) {
      if (!this.file.fetchReferenceSequenceCallback)
        throw new Error(
          'reference sequence not embedded, and seqFetch callback not provided, cannot fetch reference sequence',
        )

      const seq = await this.file.fetchReferenceSequenceCallback(
        sliceHeader.refSeqId,
        sliceHeader.refSeqStart,
        sliceHeader.refSeqStart + sliceHeader.refSeqSpan - 1,
      )

      if (seq.length !== sliceHeader.refSeqSpan)
        throw new CramArgumentError(
          'seqFetch callback returned a reference sequence of the wrong length',
        )

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

  async _fetchRecords() {
    const { majorVersion } = await this.file.getDefinition()

    const compressionScheme = await this.container.getCompressionScheme()

    const sliceHeader = await this.getHeader()

    const blocksByContentId = await this._getBlocksContentIdIndex()

    // check MD5 of reference if available
    if (
      majorVersion > 1 &&
      this.file.options.checkSequenceMD5 &&
      sliceHeader.content.refSeqId >= 0 &&
      sliceHeader.content.md5.join('') !== '0000000000000000'
    ) {
      const refRegion = await this.getReferenceRegion()
      if (refRegion) {
        const { seq, start, end } = refRegion
        const seqMd5 = sequenceMD5(seq)
        const storedMd5 = sliceHeader.content.md5
          .map(byte => (byte < 16 ? '0' : '') + byte.toString(16))
          .join('')
        if (seqMd5 !== storedMd5)
          throw new CramMalformedError(
            `MD5 checksum reference mismatch for ref ${
              sliceHeader.content.refSeqId
            } pos ${start}..${end}. recorded MD5: ${storedMd5}, calculated MD5: ${seqMd5}`,
          )
      }
    }

    // tracks the read position within the block. codec.decode() methods
    // advance the byte and bit positions in the cursor as they decode data
    // note that we are only decoding a single block here, the core data block
    const coreDataBlock = await this.getCoreDataBlock()
    const cursors = {
      lastAlignmentStart: sliceHeader.content.refSeqStart || 0,
      coreBlock: { bitPosition: 7, bytePosition: 0 },
      externalBlocks: {
        getCursor(contentId) {
          if (!this[contentId])
            this[contentId] = { bitPosition: 7, bytePosition: 0 }
          return this[contentId]
        },
      },
    }

    const decodeDataSeries = dataSeriesName => {
      const codec = compressionScheme.getCodecForDataSeries(dataSeriesName)
      if (!codec)
        throw new CramMalformedError(
          `no codec defined for ${dataSeriesName} data series`,
        )
      // console.log(dataSeriesName, Object.getPrototypeOf(codec))
      return codec.decode(this, coreDataBlock, blocksByContentId, cursors)
    }
    let records = new Array(sliceHeader.content.numRecords)
    for (let i = 0; i < records.length; i += 1) {
      try {
        records[i] = decodeRecord(
          this,
          decodeDataSeries,
          compressionScheme,
          sliceHeader,
          coreDataBlock,
          blocksByContentId,
          cursors,
          majorVersion,
          i,
        )
        records[i].uniqueId =
          sliceHeader.contentPosition +
          sliceHeader.content.recordCounter +
          i +
          1
      } catch (e) {
        if (e instanceof CramBufferOverrunError) {
          console.warn(
            'read attempted beyond end of buffer, file seems truncated.',
          )
          records = records.filter(r => !!r)
          break
        } else throw e
      }
    }

    // interpret `recordsToNextFragment` attributes to make standard `mate` objects
    // Resolve mate pair cross-references between records in this slice
    for (let i = 0; i < records.length; i += 1) {
      const { mateRecordNumber } = records[i]
      if (mateRecordNumber >= 0)
        associateIntraSliceMate(
          records,
          i,
          records[i],
          records[mateRecordNumber],
        )
    }

    return records
  }

  async getRecords(filterFunction) {
    // fetch the features if necessary, using the file-level feature cache
    const cacheKey = this.container.filePosition + this.containerPosition
    let recordsPromise = this.file.featureCache.get(cacheKey)
    if (!recordsPromise) {
      recordsPromise = this._fetchRecords()
      this.file.featureCache.set(cacheKey, recordsPromise)
    }

    const records = (await recordsPromise).filter(filterFunction)

    // if we can fetch reference sequence, add the reference sequence to the records
    if (records.length && this.file.fetchReferenceSequenceCallback) {
      const sliceHeader = await this.getHeader()
      if (
        sliceHeader.content.refSeqId >= 0 || // single-ref slice
        sliceHeader.content.refSeqId === -2 // multi-ref slice
      ) {
        const singleRefId =
          sliceHeader.content.refSeqId >= 0
            ? sliceHeader.content.refSeqId
            : undefined
        const compressionScheme = await this.container.getCompressionScheme()
        const refRegions = {} // seqId => { start, end, seq }

        // iterate over the records to find the spans of the reference sequences we need to fetch
        for (let i = 0; i < records.length; i += 1) {
          const seqId =
            singleRefId !== undefined ? singleRefId : records[i].sequenceId
          let refRegion = refRegions[seqId]
          if (!refRegion) {
            refRegion = {
              id: seqId,
              start: records[i].alignmentStart,
              end: -Infinity,
            }
            refRegions[seqId] = refRegion
          }

          const end =
            records[i].alignmentStart +
            (records[i].lengthOnRef || records[i].readLength) -
            1
          if (end > refRegion.end) refRegion.end = end
          if (records[i].alignmentStart < refRegion.start)
            refRegion.start = records[i].alignmentStart
        }

        // fetch the `seq` for all of the ref regions
        await Promise.all(
          Object.values(refRegions).map(async refRegion => {
            if (refRegion.id !== -1 && refRegion.start <= refRegion.end) {
              refRegion.seq = await this.file.fetchReferenceSequenceCallback(
                refRegion.id,
                refRegion.start,
                refRegion.end,
              )
            }
          }),
        )

        // now decorate all the records with them
        for (let i = 0; i < records.length; i += 1) {
          const seqId =
            singleRefId !== undefined ? singleRefId : records[i].sequenceId
          const refRegion = refRegions[seqId]
          if (refRegion && refRegion.seq) {
            records[i].addReferenceSequence(refRegion, compressionScheme)
          }
        }
      }
    }

    return records
  }
}

// memoize several methods in the class for performance
'getHeader getBlocks _getBlocksContentIdIndex'
  .split(' ')
  .forEach(method => tinyMemoize(CramSlice, method))

module.exports = CramSlice
