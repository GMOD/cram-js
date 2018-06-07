const sectionParsers = require('../sectionParsers')
const { parseItem } = require('../util')

// const decodeSeqAndQual = require('./decodeSeqAndQual')
const decodeSliceXref = require('./decodeSliceXref')
const decodeRecord = require('./decodeRecord')

class CramSlice {
  constructor(container, position, length) {
    this.container = container
    this.file = container.file
    this.containerPosition = position
    this.size = length
  }

  // memoize
  async getHeader() {
    // fetch and parse the slice header
    const containerHeader = await this.container.getHeader()
    const header = await this.file.readBlock(
      containerHeader._endPosition + this.containerPosition,
      this.size,
    )
    if (header.contentType === 'MAPPED_SLICE_HEADER') {
      header.content = parseItem(
        header.content,
        sectionParsers.cramMappedSliceHeader.parser,
        containerHeader._endPosition,
      )
    } else if (header.contentType === 'UNMAPPED_SLICE_HEADER') {
      header.content = parseItem(
        header.content,
        sectionParsers.cramUnmappedSliceHeader.parser,
        containerHeader._endPosition,
      )
    } else {
      throw new Error(
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

  async getReference() {
    // read the slice header
    const sliceHeader = await this.getHeader()
    const compressionBlock = await this.container.getCompressionHeaderBlock()

    // console.log(JSON.stringify(sliceHeader, null, '  '))

    const refId = sliceHeader.refSeqId
    const embeddedRefBaseID = sliceHeader.refBaseID

    if (refId >= 0) {
      if (embeddedRefBaseID >= 0) {
        const refBlock = this.getBlockByContentId(embeddedRefBaseID)
        if (!refBlock)
          throw new Error(
            'embedded reference specified, but reference block does not exist',
          )

        if (sliceHeader.span > refBlock.uncompressedSize) {
          throw new Error('Embedded reference is too small')
        }

        return {
          seq: refBlock.data.toString('ascii'),
          start: sliceHeader.refStart,
          end: sliceHeader.refStart + sliceHeader.refSpan - 1,
        }
      } else if (compressionBlock.content.referenceRequired) {
        throw new Error(
          'out-of-file reference sequence fetching not yet implemented',
        )
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
    }

    return undefined
  }

  async getAllFeatures() {
    // read the container and compression headers
    const cramMajorVersion = (await this.file.getDefinition()).majorVersion
    if (cramMajorVersion !== 3) throw new Error('only CRAM v3 files supported')

    // const containerHeader = await this.container.getHeader()
    const compressionScheme = await this.container.getCompressionScheme()

    const sliceHeader = await this.getHeader()

    const blocksByContentId = await this._getBlocksContentIdIndex()

    // TODO: calculate dataset dependencies like htslib? currently just decoding all
    const needDataSeries = (/* dataSeriesName */) => true

    // TODO: check MD5 of reference
    // if (cramMajorVersion != 1
    //   && (fd.required_fields & SAM_SEQ)
    //   && s.hdr.ref_seq_id >= 0
    //   && !fd.ignore_md5
    //   && memcmp(s.hdr.md5, "\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0", 16)) {
    //   hts_md5_context *md5;
    //   unsigned char digest[16];

    //   if (s.ref && s.hdr.ref_seq_id >= 0) {
    //       int start, len;

    //       if (s.hdr.ref_seq_start >= s.ref_start) {
    //           start = s.hdr.ref_seq_start - s.ref_start;
    //       } else {
    //           hts_log_warning("Slice starts before base 1");
    //           start = 0;
    //       }

    //       if (s.hdr.ref_seq_span <= s.ref_end - s.ref_start + 1) {
    //           len = s.hdr.ref_seq_span;
    //       } else {
    //           hts_log_warning("Slice ends beyond reference end");
    //           len = s.ref_end - s.ref_start + 1;
    //       }

    //       if (!(md5 = hts_md5_init()))
    //           return -1;
    //       if (start + len > s.ref_end - s.ref_start + 1)
    //           len = s.ref_end - s.ref_start + 1 - start;
    //       if (len >= 0)
    //           hts_md5_update(md5, s.ref + start, len);
    //       hts_md5_final(digest, md5);
    //       hts_md5_destroy(md5);
    //   } else if (!s.ref && s.hdr.ref_base_id >= 0) {
    //       cram_block *b = cram_get_block_by_id(s, s.hdr.ref_base_id);
    //       if (b) {
    //           if (!(md5 = hts_md5_init()))
    //               return -1;
    //           hts_md5_update(md5, b.data, b.uncomp_size);
    //           hts_md5_final(digest, md5);
    //           hts_md5_destroy(md5);
    //       }
    //   }
    //   if ((!s.ref && s.hdr.ref_base_id < 0)
    //       || memcmp(digest, s.hdr.md5, 16) != 0) {
    //       char M[33];
    //       hts_log_error("MD5 checksum reference mismatch for ref %d pos %d..%d",
    //                     refSeqId, s.ref_start, s.ref_end);
    //       hts_log_error("CRAM: %s", md5_print(s.hdr.md5, M));
    //       hts_log_error("Ref : %s", md5_print(digest, M));
    //       return -1;
    //   }
    // }

    // TODO: if multiple reference sequences, init a ref seqs array
    // if (refSeqId == -2) {
    //   refs = calloc(fd.refs.nref, sizeof(char *));
    // }

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
        throw new Error(`no codec defined for ${dataSeriesName} data series`)
      return codec.decode(this, coreDataBlock, blocksByContentId, cursors)
    }
    const records = new Array(sliceHeader.content.numRecords)
    for (let i = 0; i < sliceHeader.content.numRecords; i += 1) {
      records[i] = decodeRecord(
        this,
        decodeDataSeries,
        compressionScheme,
        sliceHeader,
        coreDataBlock,
        blocksByContentId,
        cursors,
      )
    }

    // if the starts are delta from the previous, go through and calculate the true starts
    if (compressionScheme.APdelta) {
      let lastStart = sliceHeader.refSeqStart || 0
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

module.exports = CramSlice
