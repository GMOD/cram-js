const {
  CramMalformedError,
  CramBufferOverrunError,
  CramArgumentError,
} = require('../../errors')
const { parseItem, tinyMemoize, sequenceMD5 } = require('../util')

const decodeRecord = require('./decodeRecord')

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
    // const lastAPos = sliceHeader.content.refSeqStart // < used for delta-encoded `apos` in records
    const decodeDataSeries = dataSeriesName => {
      const codec = compressionScheme.getCodecForDataSeries(dataSeriesName)
      if (!codec)
        throw new CramMalformedError(
          `no codec defined for ${dataSeriesName} data series`,
        )
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
        records[i].uniqueId = sliceHeader.content.recordCounter + i
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
      if (mateRecordNumber >= 0) {
        const thisRecord = records[i]
        const mateRecord = records[mateRecordNumber]
        if (!mateRecord)
          throw new CramMalformedError(
            'could not resolve intra-slice mate pairs, file seems truncated or malformed',
          )
        mateRecord.mate = {
          sequenceId: thisRecord.sequenceId,
          alignmentStart: thisRecord.alignmentStart,
        }
        if (thisRecord.readName) mateRecord.mate.readName = thisRecord.readName
        thisRecord.mate = {
          sequenceId: mateRecord.sequenceId,
          alignmentStart: mateRecord.alignmentStart,
        }
        if (mateRecord.readName) thisRecord.mate.readName = mateRecord.readName
        delete thisRecord.mateRecordNumber
      }
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
      if (sliceHeader.content.refSeqId >= 0) {
        const compressionScheme = await this.container.getCompressionScheme()
        const refStart = records[0].alignmentStart
        const lastRecord = records[records.length - 1]
        const refEnd = lastRecord.alignmentStart + lastRecord.lengthOnRef - 1
        const seq = await this.file.fetchReferenceSequenceCallback(
          sliceHeader.content.refSeqId,
          refStart,
          refEnd,
        )
        const refRegion = { seq, start: refStart, end: refEnd }
        records.forEach(r => {
          r.addReferenceSequence(refRegion, compressionScheme)
        })
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
