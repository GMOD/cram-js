const Long = require('long')
const sectionParsers = require('../sectionParsers')
const { parseItem } = require('../util')

// const decodeSeqAndQual = require('./decodeSeqAndQual')
const decodeSliceXref = require('./decodeSliceXref')
const Constants = require('../constants')

// const unknownRG = -1

class CramRecord {
  constructor() {
    this.tags = {}
  }
  isDetached() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_DETACHED)
  }

  hasMateDownStream() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_MATE_DOWNSTREAM)
  }

  isSegmentUnmapped() {
    return !!(this.flags & Constants.BAM_FUNMAP)
  }

  isPreservingQualityScores() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_PRESERVE_QUAL_SCORES)
  }
}

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
    for (let rec = 0; rec < sliceHeader.content.numRecords; rec += 1) {
      records[rec] = this.readFeature(
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

  readFeature(
    decodeDataSeries,
    compressionScheme,
    sliceHeader,
    coreDataBlock,
    blocksByContentId,
    cursors,
  ) {
    const cramRecord = new CramRecord()

    cramRecord.flags = decodeDataSeries('BF')
    cramRecord.compressionFlags = decodeDataSeries('CF')
    if (sliceHeader.content.refSeqId === -2)
      cramRecord.sequenceId = decodeDataSeries('RI')
    else cramRecord.sequenceId = sliceHeader.content.refSeqId

    cramRecord.readLength = decodeDataSeries('RL')
    // if APDelta, will calculate the true start in a second pass
    cramRecord.alignmentStart = decodeDataSeries('AP')
    cramRecord.readGroupID = decodeDataSeries('RG')

    if (compressionScheme.readNamesIncluded)
      cramRecord.readName = decodeDataSeries('RN').toString('ascii') // new String(readNameCodec.readData(), charset)

    // mate record
    if (cramRecord.isDetached()) {
      cramRecord.mateFlags = decodeDataSeries('MF')
      cramRecord.mate = {}
      if (!compressionScheme.readNamesIncluded)
        cramRecord.mate.readName = decodeDataSeries('RN') // new String(readNameCodec.readData(), charset)
      cramRecord.mate.sequenceID = decodeDataSeries('NS')
      cramRecord.mate.alignmentStart = decodeDataSeries('NP')
      cramRecord.templateSize = decodeDataSeries('TS')
      // detachedCount++
    } else if (cramRecord.hasMateDownStream()) {
      cramRecord.recordsToNextFragment = decodeDataSeries('NF')
    }

    const TLindex = decodeDataSeries('TL')
    if (TLindex < 0)
      /* TODO: check nTL: TLindex >= compressionHeader.tagEncoding.size */
      throw new Error('invalid TL index')

    // TN = tag names
    const TN = compressionScheme.getTagNames(TLindex)
    const ntags = TN.length

    for (let i = 0; i < ntags; i += 1) {
      const tagId = TN[i]
      const tagName = tagId.substr(0, 2)
      const tagType = tagId.substr(2, 1)

      // if (tagName[0] === 'M' && tagName[1] === 'D') hasMD = true
      // if (tagName[0] === 'N' && tagName[1] === 'M') hasNM = true

      const tagCodec = compressionScheme.getCodecForTag(tagId)
      if (!tagCodec)
        throw new Error(`no codec defined for auxiliary tag ${tagId}`)
      const tagData = tagCodec.decode(
        this,
        coreDataBlock,
        blocksByContentId,
        cursors,
      )
      cramRecord.tags[tagName] = this.parseTagData(tagType, tagData)
    }
    // const /* Integer */ tagIdList = tagIdListCodec.readData()
    // const /* byte[][] */ ids = tagIdDictionary[tagIdList]
    // if (ids.length > 0) {
    //   const /* int */ tagCount = ids.length
    //   cramRecord.tags = new ReadTag[tagCount]()
    //   for (let i = 0; i < ids.length; i++) {
    //     const /* int */ id = ReadTag.name3BytesToInt(ids[i])
    //     const /* DataReader<byte[]> */ dataReader = tagValueCodecs.get(id)
    //     const /* ReadTag */ tag = new ReadTag(
    //       id,
    //       dataReader.readData(),
    //       validationStringency,
    //     )
    //     cramRecord.tags[i] = tag
    //   }
    // }

    if (!cramRecord.isSegmentUnmapped()) {
      // reading read features:
      const /* int */ size = decodeDataSeries('FN')
      let /* int */ prevPos = 0
      const /* java.util.List<ReadFeature> */ readFeatures = new Array(
        size,
      ) /* new LinkedList<ReadFeature>(); */
      cramRecord.readFeatures = readFeatures
      for (let i = 0; i < size; i += 1) {
        const /* Byte */ operator = String.fromCharCode(decodeDataSeries('FC'))

        const /* int */ position = prevPos + decodeDataSeries('FP')
        prevPos = position

        const readFeature = { operator, position }
        // map of operator name -> data series name
        const data1DataSeriesName = {
          B: 'BA',
          S: 'SC', // TODO: 'IN' if cram v1
          X: 'BS',
          D: 'DL',
          I: 'IN',
          i: 'BA',
          b: 'BB',
          q: 'QQ',
          Q: 'QS',
          H: 'HC',
          P: 'PD',
          N: 'RS',
        }[operator]

        if (!data1DataSeriesName)
          throw new Error(`invalid read feature operator "${operator}"`)

        readFeature.data1 = decodeDataSeries(data1DataSeriesName)

        // map of operator name -> data
        const data2DataSeriesName = { B: 'QS' }[operator]
        if (data2DataSeriesName)
          readFeature.data2 = decodeDataSeries(data2DataSeriesName)

        readFeatures[i] = readFeature

        // if (operator === 'B') {
        //   // ReadBase
        //   const /* ReadBase */ readBase = new ReadBase(
        //     pos,
        //     baseCodec.readData(),
        //     qualityScoreCodec.readData(),
        //   )
        //   readFeature.base =
        // } else if (operator === 'X') {
        //   const /* Substitution */ substitution = new Substitution()
        //   substitution.setPosition(pos)
        //   const /* byte */ code = baseSubstitutionCodec.readData()
        //   substitution.setCode(code)
        // } else if (operator === 'I') {
        //   const /* Insertion */ insertion = new Insertion(
        //     pos,
        //     insertionCodec.readData(),
        //   )
        // } else if (operator === 'S') {
        //   const /* SoftClip */ softClip = new SoftClip(
        //     pos,
        //     softClipCodec.readData(),
        //   )
        // } else if (operator === 'H') {
        //   const /* HardClip */ hardCLip = new HardClip(
        //     pos,
        //     hardClipCodec.readData(),
        //   )
        // } else if (operator === 'P') {
        //   const /* Padding */ padding = new Padding(
        //     pos,
        //     paddingCodec.readData(),
        //   )
        //   readFeatures[i] = padding
        // } else if (operator === 'D') {
        //   const /* Deletion */ deletion = new Deletion(
        //     pos,
        //     deletionLengthCodec.readData(),
        //   )
        // } else if (operator === 'N') {
        //   const /* RefSkip */ refSkip = new RefSkip(
        //     pos,
        //     refSkipCodec.readData(),
        //   )
        // } else if (operator === 'i') {
        //   const /* InsertBase */ insertBase = new InsertBase(
        //     pos,
        //     baseCodec.readData(),
        //   )
        // } else if (operator === 'Q') {
        //   const /* BaseQualityScore */ baseQualityScore = new BaseQualityScore(
        //     pos,
        //     qualityScoreCodec.readData(),
        //   )
        // } else if (operator === 'b') {
        //   const /* Bases */ bases = new Bases(pos, basesCodec.readData())
        // } else if (operator === 'q') {
        //   const /* Scores */ scores = new Scores(pos, scoresCodec.readData())
        // } else {
        //   throw new Error(`Unknown read feature operator: ${operator}`)
        // }
      }

      // mapping quality:
      cramRecord.mappingQuality = decodeDataSeries('MQ')
      if (cramRecord.isPreservingQualityScores()) {
        cramRecord.qualityScores = new Array(cramRecord.readLength).map(() =>
          decodeDataSeries('QS'),
        )
        // qualityScoresCodec.readDataArray(
        //   cramRecord.readLength,
        // )
      }
    } else if (cramRecord.isUnknownBases()) {
      cramRecord.readBases = null
      cramRecord.qualityScores = null
    } else {
      const /* byte[] */ bases = new Array(
        cramRecord.readLength,
      ) /* new byte[cramRecord.readLength]; */
      for (let i = 0; i < bases.length; i += 1)
        bases[i] = decodeDataSeries('BA')
      cramRecord.readBases = bases

      if (cramRecord.isPreservingQualityScores()) {
        cramRecord.qualityScores = new Array(cramRecord.readLength).map(() =>
          decodeDataSeries('QS'),
        )
      }
    }

    // recordCounter++

    // prevRecord = cramRecord

    return cramRecord
  }

  parseTagData(tagType, buffer) {
    if (tagType === 'Z') return this.readNullTerminatedStringFromBuffer(buffer)
    else if (tagType === 'A') return String.fromCharCode(buffer[0])
    else if (tagType === 'I') {
      const val = Long.fromBytesLE(buffer)
      if (
        val.greaterThan(Number.MAX_SAFE_INTEGER) ||
        val.lessThan(Number.MIN_SAFE_INTEGER)
      )
        throw new Error('integer overflow')
      return val.toNumber()
    } else if (tagType === 'i') return buffer.readInt32LE()
    else if (tagType === 's') return buffer.readInt16LE()
    else if (tagType === 'S')
      // Convert to unsigned short stored in an int
      return buffer.readInt16LE() & 0xffff
    else if (tagType === 'c') return buffer[0]
    else if (tagType === 'C')
      // Convert to unsigned byte stored in an int
      return buffer[0] & 0xff
    else if (tagType === 'f') return buffer.readFloatLE()
    if (tagType === 'H') {
      const hex = this.readNullTerminatedStringFromBuffer(buffer)
      return Number.parseInt(hex.replace(/^0x/, ''), 16)
    }
    if (tagType === 'B') return this.parseTagValueArray(buffer)

    throw new Error(`Unrecognized tag type ${tagType}`)
  }

  /** given a Buffer, read a string up to the first null character */
  readNullTerminatedStringFromBuffer(buffer) {
    const zeroOffset = buffer.indexOf(0)
    if (zeroOffset === -1) return buffer.toString('ascii')
    return buffer.toString('ascii', 0, zeroOffset)
  }

  /** parse a BAM tag's array value from a binary buffer */
  parseTagValueArray(/* buffer */) {
    throw new Error('parseTagValueArray not yet implemented') // TODO
  }
}

module.exports = CramSlice
