const md5 = require('md5')

const {
  CramMalformedError,
  CramUnimplementedError,
  CramBufferOverrunError,
} = require('../../errors')
const { parseItem, tinyMemoize } = require('../util')

// const decodeSeqAndQual = require('./decodeSeqAndQual')
const decodeSliceXref = require('./decodeSliceXref')
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

  async getReferenceRegion(/* optional */ requestedRefId) {
    // read the slice header
    const sliceHeader = (await this.getHeader()).content
    const compressionScheme = await this.container.getCompressionScheme()

    // console.log(JSON.stringify(sliceHeader, null, '  '))

    if (sliceHeader.refSeqId >= 0) {
      if (requestedRefId >= 0 && requestedRefId !== sliceHeader.refSeqId)
        throw new Error(
          'attempt to fetch an unrelated reference sequence from a slice',
        )

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
      } else if (compressionScheme.referenceRequired) {
        if (!this.file.fetchReferenceSequenceCallback)
          throw new Error(
            'reference sequence not embedded, and seqFetch callback not provided, cannot fetch reference sequence',
          )

        const seq = await this.file.fetchReferenceSequenceCallback(
          sliceHeader.refSeqId,
          sliceHeader.refSeqStart,
          sliceHeader.refSeqSpan,
        )

        return {
          seq,
          start: sliceHeader.refSeqStart,
          end: sliceHeader.refSeqStart + sliceHeader.refSeqSpan - 1,
          span: sliceHeader.refSeqSpan,
        }

        // if (fd.required_fields & SAM_SEQ)
        //     s.ref =
        //     cram_get_ref(fd, sliceHeader.ref_seq_id,
        //                  sliceHeader.ref_seq_start,
        //                  sliceHeader.ref_seq_start + sliceHeader.ref_seq_span -1);
        // s.ref_start = sliceHeader.ref_seq_start;
        // s.ref_end   = sliceHeader.ref_seq_start + sliceHeader.ref_seq_span-1;
        // /* Sanity check */
        // if (s.ref_start < 0) {
        //     hts_log_warning("Slice starts before base 1");
        //     s.ref_start = 0;
        // }
        // if ((fd.required_fields & SAM_SEQ) &&
        //     refSeqId < fd.refs.nref &&
        //     s.ref_end > fd.refs.refSeqId[refSeqId].length) {
        //     s.ref_end = fd.refs.refSeqId[refSeqId].length;
        // }
      }
    } else if (sliceHeader.refSeqId === -2) {
      // this is a multi-reference slice
      throw new CramUnimplementedError(
        'ref seq fetching not yet implemented for multi-reference slices',
      )
    }

    return undefined
  }

  async getAllFeatures() {
    const { majorVersion } = await this.file.getDefinition()

    const compressionScheme = await this.container.getCompressionScheme()

    const sliceHeader = await this.getHeader()

    const blocksByContentId = await this._getBlocksContentIdIndex()

    // TODO: calculate dataset dependencies like htslib? currently just decoding all
    const needDataSeries = (/* dataSeriesName */) => true

    // check MD5 of reference if available
    if (
      majorVersion > 1 &&
      sliceHeader.content.refSeqId >= 0 &&
      sliceHeader.content.md5.join('') !== '0000000000000000'
    ) {
      const refRegion = await this.getReferenceRegion()
      if (refRegion) {
        const { seq, start, end } = refRegion
        const seqMd5 = md5(seq)
        const storedMd5 = sliceHeader.content.md5
          .map(byte => (byte < 15 ? '0' : '') + byte.toString(16))
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
    for (let i = 0; i < sliceHeader.content.numRecords; i += 1) {
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

    // if the starts are delta from the previous, go through and calculate the true starts
    if (compressionScheme.APdelta) {
      let lastStart = sliceHeader.content.refSeqStart || 0
      records.forEach(rec => {
        rec.alignmentStart += lastStart
        lastStart = rec.alignmentStart
      })
    }

    // Resolve mate pair cross-references between records in this slice
    decodeSliceXref(this, needDataSeries)

    return records
  }
}

// memoize several methods in the class for performance
'getHeader getBlocks _getBlocksContentIdIndex'
  .split(' ')
  .forEach(method => tinyMemoize(CramSlice, method))

module.exports = CramSlice
