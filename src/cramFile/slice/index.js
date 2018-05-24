const sectionParsers = require('../sectionParsers')
const { parseItem } = require('../util')

const decodeSeqAndQual = require('./decodeSeqAndQual')
const decodeSliceXref = require('./decodeSliceXref')

const CRAM_FLAG_PRESERVE_QUAL_SCORES = 1 << 0
const CRAM_FLAG_DETACHED = 1 << 1
const CRAM_FLAG_MATE_DOWNSTREAM = 1 << 2
// const CRAM_FLAG_NO_SEQ = 1 << 3
// const CRAM_FLAG_MASK = (1 << 4) - 1

/*! @abstract the read is paired in sequencing, no matter whether it is mapped in a pair */
// const BAM_FPAIRED = 1
// /*! @abstract the read is mapped in a proper pair */
// const BAM_FPROPER_PAIR = 2
/*! @abstract the read itself is unmapped; conflictive with BAM_FPROPER_PAIR */
const BAM_FUNMAP = 4
/*! @abstract the mate is unmapped */
// const BAM_FMUNMAP = 8
// /*! @abstract the read is mapped to the reverse strand */
// const BAM_FREVERSE = 16
// /*! @abstract the mate is mapped to the reverse strand */
// const BAM_FMREVERSE = 32
// /*! @abstract this is read1 */
// const BAM_FREAD1 = 64
// /*! @abstract this is read2 */
// const BAM_FREAD2 = 128
// /*! @abstract not primary alignment */
// const BAM_FSECONDARY = 256
// /*! @abstract QC failure */
// const BAM_FQCFAIL = 512
// /*! @abstract optical or PCR duplicate */
// const BAM_FDUP = 1024
// /*! @abstract supplementary alignment */
// const BAM_FSUPPLEMENTARY = 2048

const unknownRG = -1

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
    this.blocksByContentId = {}
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
        this.blocksByContentId[block.contentId] = block
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
    // const containerHeader = await this.container.getHeader()
    // const compressionBlock = await this.container.getCompressionHeaderBlock()

    const containerHeader = await this.container.getHeader()
    const compressionScheme = await this.container.getCompressionScheme()

    // read the slice header
    const sliceHeader = await this.getHeader()

    const blocksByContentId = await this._getBlocksContentIdIndex()

    // TODO: calculate dataset dependencies? currently just decoding all
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
    let lastAPos = 0 // < used for delta-encoded `apos` in records
    const decodeDataSeries = dataSeriesName => {
      const codec = compressionScheme.getCodecForDataSeries(dataSeriesName)
      if (!codec)
        throw new Error(`no codec defined for ${dataSeriesName} data series`)
      return codec.decode(this, coreDataBlock, blocksByContentId, cursors)
    }
    const records = new Array(sliceHeader.content.numRecords)
    for (let rec = 0; rec < sliceHeader.content.numRecords; rec += 1) {
      // const lastRefId = -9 // Arbitrary -ve marker for not-yet-set
      const cr = {}
      records[rec] = cr

      // fprintf(stderr, "Decode seq %d, %d/%d\n", rec, blk.byte, blk.bit);

      // cr.slice = this

      // BF = bit flags (see separate section)
      if (needDataSeries('BF')) {
        cr.flags = decodeDataSeries('BF')
        // TODO: do we need to worry about bam_flag_swap? seems like this was here for CRAM v1 backcompat
        // if (r || bf < 0 ||
        //     bf >= sizeof(fd.bam_flag_swap)/sizeof(*fd.bam_flag_swap))
        //     return -1;
        // bf = fd.bam_flag_swap[bf];
      } else {
        cr.flags = 0x4
      }

      // CF = compression bit flags (see section)
      if (needDataSeries('CF')) {
        cr.cramFlags = decodeDataSeries('CF')
      } else {
        cr.cramFlags = 0
      }

      if (cramMajorVersion !== 1 && sliceHeader.refSeqId === -2) {
        // RI  = reference ID (record reference id from the BAM file header)
        if (needDataSeries('RI')) {
          cr.refSeqId = decodeDataSeries('RI')
          // if ((fd.required_fields(SAM_SEQ|SAM_TLEN))
          //     && cr.refSeqId >= 0
          //     && cr.refSeqId !== lastRefId) {
          //     if (compressionScheme.referenceRequired) {
          //         // Range(fd):  seq >= 0, unmapped -1, unspecified   -2
          //         // Slice(s):   seq >= 0, unmapped -1, multiple refs -2
          //         // Record(cr): seq >= 0, unmapped -1
          //         const need_ref = (fd.range.refid == -2 || cr.refSeqId == fd.range.refid);
          //         if  (need_ref) {
          //             if (!refs[cr.refSeqId])
          //                 refs[cr.refSeqId] = cram_get_ref(fd, cr.refSeqId, 1, 0);
          //             if (!(s.ref = refs[cr.refSeqId]))
          //                 return -1;
          //         } else {
          //             // For multi-ref containers, we don't need to fetch all
          //             // refs if we're only querying one.
          //             s.ref = NULL;
          //         }

          //         int discard_last_ref = (!fd.unsorted &&
          //                                 last_ref_id >= 0 &&
          //                                 refs[last_ref_id] &&
          //                                 (fd.range.refid == -2 ||
          //                                  last_ref_id == fd.range.refid));
          //         if  (discard_last_ref) {
          //             cram_ref_decr(fd.refs, last_ref_id);
          //             refs[last_ref_id] = NULL;
          //         }
          //     }
          //     s.ref_start = 1;
          //     s.ref_end = fd.refs.refSeqId[cr.refSeqId].length;

          //     last_ref_id = cr.refSeqId;
          // }
        } else {
          cr.refSeqId = -1
        }
      } else {
        cr.refSeqId = sliceHeader.refSeqId // Forced constant in CRAM 1.0
      }

      // RL = read lengths
      if (needDataSeries('RL')) {
        cr.length = decodeDataSeries('RL')
        if (cr.length < 0) throw new Error('read has negative length')
      }

      // AP = in-seq positions (0-based alignment start delta from previous record)
      if (needDataSeries('AP')) {
        cr.apos = decodeDataSeries('AP')
        if (compressionScheme.AP_delta) {
          cr.apos += lastAPos
          lastAPos = cr.apos
        }
      } else {
        cr.apos = containerHeader.refSeqStart
      }

      // RG = read groups (read groups. Special value ‘-1’ stands for no group.)
      if (needDataSeries('RG')) {
        cr.rg = decodeDataSeries('RG')
        if (cr.rg === unknownRG) cr.rg = -1
      } else {
        cr.rg = -1
      }

      if (compressionScheme.readNamesIncluded && needDataSeries('RN')) {
        // Read directly into name cram_block
        cr.name = decodeDataSeries('RN')
      }

      cr.mate = { pos: 0, line: -1, refSeqId: -1 }
      // CF = compression bit flags
      if (needDataSeries('CF') && cr.cramFlags & CRAM_FLAG_DETACHED) {
        // MF = next mate bit flags
        if (needDataSeries('MF')) {
          cr.mateFlags = decodeDataSeries('MF')
        } else {
          cr.mateFlags = 0
        }

        if (!compressionScheme.readNamesIncluded) {
          // RN = read names
          if (needDataSeries('RN')) cr.mate.name = decodeDataSeries('RN')
        }

        // NS = next fragment reference sequence id
        if (needDataSeries('NS')) {
          cr.mate.refSeqId = decodeDataSeries('NS')
        }

        // Skip as mate_ref of "*" is legit. It doesn't mean unmapped, just unknown.
        // if (cr.mate_ref_id == -1 && cr.flags & 0x01) {
        //     /* Paired, but unmapped */
        //     cr.flags |= BAM_FMUNMAP;
        // }

        // NP = next mate alignment start (alignment positions for the next fragment)
        if (needDataSeries('NP')) {
          cr.mate.pos = decodeDataSeries('NP')
        }

        // TS = template sizes
        if (needDataSeries('TS')) {
          cr.templateLength = decodeDataSeries('TS')
        } else {
          cr.templateLength = -Infinity
        }
      } else if (
        needDataSeries('CF') &&
        cr.cramFlags & CRAM_FLAG_MATE_DOWNSTREAM
      ) {
        // NF = distance to next fragment
        if (needDataSeries('NF')) {
          cr.mate.line = decodeDataSeries('NF')

          cr.mate.refSeqId = -1
          cr.templateLength = -Infinity
          cr.mate.pos = 0
        } else {
          cr.mateFlags = 0
          cr.templateLength = -Infinity
        }
      } else {
        cr.mateFlags = 0
        cr.templateLength = -Infinity
      }

      /* Auxiliary tags */
      let hasMD = false
      let hasNM = false
      // TODO: factor out aux tag decoding like in htslib if we want to support CRAM v1
      // if (cramMajorVersion == 1)
      //     r |= cram_decode_aux_1_0(c, s, blk, cr);
      // else

      cr.aux = {}
      if (needDataSeries('TL') || needDataSeries('aux')) {
        const TLindex = decodeDataSeries('TL')
        if (
          TLindex <
          0 /* TODO: check nTL: TLindex >= compressionHeader.tagEncoding.size */
        )
          throw new Error('invalid TL index')

        if (needDataSeries('aux')) {
          // TN = tag names
          const TN = compressionScheme.getTagNames(TLindex)
          const ntags = TN.length

          for (let i = 0; i < ntags; i += 1) {
            const tagName = TN[i]

            if (tagName[0] === 'M' && tagName[1] === 'D') hasMD = true
            if (tagName[0] === 'N' && tagName[1] === 'M') hasNM = true

            const tagCodec = compressionScheme.getTagCodec(tagName)
            if (!tagCodec)
              throw new Error(`no codec defined for auxiliary tag ${tagName}`)
            cr.aux[tagName] = tagCodec.decode(this, coreDataBlock, cursors)
          }
        }
      }

      console.log(cr)

      if (!(cr.flags & BAM_FUNMAP)) {
        // AP = in-seq positions (0-based alignment start delta from previous record)
        if (needDataSeries('AP') && cr.apos <= 0) {
          throw new Error(
            `Read has alignment position ${cr.apos} but no unmapped flag`,
          )
        }
        /* Decode sequence and generate CIGAR */
        // MQ = mapping qualities (mapping quality scores)
        if (needDataSeries('SEQ') || needDataSeries('MQ')) {
          // TODO
          // cram_decode_seq(fd, c, s, blk, cr, bfd, cf, seq, qual, hasMD, hasNM)
          ;[cr.seq, cr.qual] = decodeSeqAndQual(this, cr, hasMD, hasNM)
        } else {
          cr.cigar = 0
          cr.ncigar = 0
          cr.aend = cr.apos
          cr.mqual = 0
        }
      } else {
        // console.log("Unmapped");
        cr.cigar = 0
        cr.ncigar = 0
        cr.aend = cr.apos
        cr.mqual = 0

        // BA = bases
        if (needDataSeries('BA') && cr.length) {
          cr.seq = decodeDataSeries('BA')
        }

        // CF = compression bit flags
        if (
          needDataSeries('CF') &&
          cr.cram_flags & CRAM_FLAG_PRESERVE_QUAL_SCORES
        ) {
          // QS = quality scores
          if (needDataSeries('QS') && cr.length >= 0) {
            cr.qual = decodeDataSeries('QS')
          }
        } else if (needDataSeries('RL'))
          // RL = read lengths
          cr.qual = new Array(cr.length)
            .map(() => String.fromCharCode(255))
            .join('')
      }
    }

    /* Resolve mate pair cross-references between recs within this slice */
    // cram_decode_slice_xref(s, fd.required_fields)
    decodeSliceXref(this, needDataSeries)

    return records
  }
}

module.exports = CramSlice
