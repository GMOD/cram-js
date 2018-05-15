const crc32 = require('buffer-crc32')

const sectionParsers = require('./sectionParsers')

const { itf8Size } = require('./cramTypes')

class CramFile {
  /**
   * @param {object} filehandle - a filehandle that implements the stat() and
   * read() methods of the Node filehandle API https://nodejs.org/api/fs.html#fs_class_filehandle
   */
  constructor(filehandle) {
    this.file = filehandle
    this.validateChecksums = true
  }

  // can just read this object like a filehandle
  read(buffer, offset, length, position) {
    return this.file.read(buffer, offset, length, position)
  }

  async definition() {
    const { cramFileDefinition } = sectionParsers
    const headbytes = Buffer.allocUnsafe(cramFileDefinition.maxLength)
    await this.file.read(headbytes, 0, cramFileDefinition.maxLength, 0)
    return cramFileDefinition.parser.parse(headbytes).result
  }

  async containerHeader(containerNumber) {
    let offset = sectionParsers.cramFileDefinition.maxLength
    const { size: fileSize } = await this.file.stat()
    const { cramContainerHeader1 } = sectionParsers

    // skip with a series of reads to the proper container
    let currentHeader
    for (
      let i = 0;
      i <= containerNumber &&
      offset + cramContainerHeader1.maxLength + 8 < fileSize;
      i += 1
    ) {
      currentHeader = await this.readContainerHeader(offset)
      offset += currentHeader._size + currentHeader.length
    }

    return currentHeader
  }

  async readContainerHeader(offset) {
    const { cramContainerHeader1, cramContainerHeader2 } = sectionParsers
    const { size: fileSize } = await this.file.stat()

    if (offset >= fileSize) return undefined

    // parse the container header. do it in 2 pieces because you cannot tell
    // how much to buffer until you read numLandmarks
    const bytes1 = Buffer.allocUnsafe(cramContainerHeader1.maxLength)
    await this.file.read(bytes1, 0, cramContainerHeader1.maxLength, offset)
    const header1 = this.constructor._parse(bytes1, cramContainerHeader1.parser)
    const numLandmarksSize = itf8Size(header1.numLandmarks)

    const bytes2 = Buffer.allocUnsafe(
      cramContainerHeader2.maxLength(header1.numLandmarks),
    )
    await this.file.read(
      bytes2,
      0,
      cramContainerHeader2.maxLength(header1.numLandmarks),
      offset + header1._size - numLandmarksSize,
    )
    const header2 = this.constructor._parse(bytes2, cramContainerHeader2.parser)

    if (this.validateChecksums) {
      await this._checkCrc32(
        offset,
        header1._size + header2._size - numLandmarksSize - 4,
        header2.crc32,
        `container header beginning at offset ${offset}`,
      )
    }

    const completeHeader = Object.assign(header1, header2, {
      _size: header1._size + header2._size - numLandmarksSize,
      _endOffset: header1._size + header2._size - numLandmarksSize + offset,
    })

    return completeHeader
  }

  static _parse(buffer, parser, startBufferOffset = 0, startFileOffset = 0) {
    const { offset, result } = parser.parse(buffer)
    result._endOffset = offset + startFileOffset
    result._size = offset - startBufferOffset
    return result
  }

  async _checkCrc32(offset, length, recordedCrc32, description) {
    const b = Buffer.allocUnsafe(length)
    await this.file.read(b, 0, length, offset)
    const calculatedCrc32 = crc32.unsigned(b)
    if (calculatedCrc32 !== recordedCrc32) {
      throw new Error(
        `crc mismatch in ${description}: recorded CRC32 = ${recordedCrc32}, but calculated CRC32 = ${calculatedCrc32}`,
      )
    }
  }

  /**
   * @returns {number} the number of containers in the file
   */
  async containerCount() {
    let offset = sectionParsers.cramFileDefinition.maxLength
    const { size: fileSize } = await this.file.stat()
    const { cramContainerHeader1 } = sectionParsers

    let i
    for (
      i = 0;
      offset + cramContainerHeader1.maxLength + 8 < fileSize;
      i += 1
    ) {
      const currentHeader = await this.readContainerHeader(offset)
      offset += currentHeader._size + currentHeader.length
    }

    return i + 1
  }

  async readBlockHeader(offset) {
    const { cramBlockHeader } = sectionParsers
    const { size: fileSize } = await this.file.stat()

    if (offset >= fileSize) return undefined

    const buffer = Buffer.allocUnsafe(cramBlockHeader.maxLength)
    await this.file.read(buffer, 0, cramBlockHeader.maxLength, offset)
    return this.constructor._parse(buffer, cramBlockHeader.parser, 0, offset)
  }

  async readCompressionHeader(offset, size) {
    return this._parseSection(
      sectionParsers.cramCompressionHeader,
      offset,
      size,
    )
  }

  async _parseSection(
    section,
    offset,
    size = section.maxLength,
    preReadBuffer,
  ) {
    const { size: fileSize } = await this.file.stat()

    if (offset + size >= fileSize) return undefined

    let buffer
    if (preReadBuffer) {
      buffer = preReadBuffer
    } else {
      buffer = Buffer.allocUnsafe(size)
      await this.file.read(buffer, 0, size, offset)
    }
    const data = this.constructor._parse(buffer, section.parser, 0, offset)
    if (data._size !== size)
      throw new Error(
        `section read error: requested size ${size} does not equal parsed size ${
          data._size
        }`,
      )
    return data
  }
  // async readSliceHeader(offset, size) {
  //   const { cramMappedSliceHeader, cramUnmappedSliceHeader } = sectionParsers
  //   const { size: fileSize } = await this.file.stat()

  //   if (offset + size >= fileSize) return undefined

  //   const buffer = Buffer.allocUnsafe(size)
  //   await this.file.read(buffer, 0, size, offset)
  //   const data = this.constructor._parse(
  //     buffer,
  //     cramSliceHeader.parser,
  //     0,
  //     offset,
  //   )
  //   if (data._size !== size)
  //     throw new Error(
  //       `compression header read error: requested size ${size} does not equal parsed size ${
  //         data._size
  //       }`,
  //     )
  //   return data
  // }

  async readBlock(offset) {
    const block = await this.readBlockHeader(offset)
    const blockContentOffset = block._endOffset

    if (block.contentType === 'FILE_HEADER') {
      throw new Error('FILE_HEADER not yet implemented')
    } else if (block.contentType === 'COMPRESSION_HEADER') {
      if (block.compressionMethod !== 'raw')
        block.content = await this._parseSection(
          sectionParsers.cramCompressionHeader,
          blockContentOffset,
          block.compressedSize,
        )
    } else if (block.contentType === 'MAPPED_SLICE_HEADER') {
      block.content = await this._parseSection(
        sectionParsers.cramMappedSliceHeader,
        blockContentOffset,
        block.compressedSize,
      )
    } else if (block.contentType === 'UNMAPPED_SLICE_HEADER') {
      block.content = await this._parseSection(
        sectionParsers.cramUnmappedSliceHeader,
        blockContentOffset,
        block.compressedSize,
      )
    } else if (block.contentType === 'EXTERNAL_DATA') {
      throw new Error('EXTERNAL_DATA not yet implemented')
    } else if (block.contentType === 'CORE_DATA') {
      const uncompressedData = Buffer.allocUnsafe(block.uncompressedSize)

      if (block.compressionMethod !== 'raw') {
        const compressedData = Buffer.allocUnsafe(block.compressedSize)
        await this.read(
          compressedData,
          0,
          block.compressedSize,
          blockContentOffset,
        )
        // TODO: uncompress the data
        throw new Error(
          `${block.compressionMethod} decoding not yet implemented`,
        )
      } else {
        await this.read(
          uncompressedData,
          0,
          block.uncompressedSize,
          blockContentOffset,
        )
      }

      // now we have the block data
      throw new Error('CORE_DATA not yet implemented')
    }

    // parse the crc32
    const crc = await this._parseSection(
      sectionParsers.cramBlockCrc32,
      blockContentOffset + block.compressedSize,
    )
    block.crc32 = crc.crc32

    // check the block data crc32
    if (this.validateChecksums) {
      await this._checkCrc32(
        offset,
        block._size + block.compressedSize,
        block.crc32,
        'block data',
      )
    }

    // make the endoffset and size we return reflect the whole block
    block._endOffset = crc._endOffset
    block._size = block.compressedSize + sectionParsers.cramBlockCrc32.maxLength

    return block
  }

  async getFeaturesFromSlice(containerStart, sliceStart, sliceBytes) {
    // read the container and compression headers
    const containerHeader = await this.readContainerHeader(containerStart)
    const compressionBlock = await this.readBlock(containerHeader._endOffset)

    // now read the slice
    const sliceHeader = await this.readBlock(
      containerHeader._endOffset + sliceStart,
      sliceBytes,
    )

    console.log(JSON.stringify(sliceHeader, null, '  '))

    // read all the blocks in the slice
    const blocks = new Array(sliceHeader.content.numBlocks)
    let blockOffset = sliceHeader._endOffset
    for (let i = 0; i < sliceHeader.content.numBlocks; i += 1) {
      blocks[i] = await this.readBlock(blockOffset)
      blockOffset = blocks[i]._endOffset
    }

    console.log(JSON.stringify(blocks, null, '  '))
    //

    return []
  }
}
class IndexedCramFile {
  constructor({ cram, index /* fasta, fastaIndex */ }) {
    if (!(cram instanceof CramFile)) this.cram = new CramFile(cram)
    else this.cram = cram

    this.index = index
  }

  async getFeaturesForRange(seq, start, end) {
    if (typeof seq === 'string')
      // TODO: support string reference sequence names somehow
      throw new Error('string sequence names not yet supported')
    const seqId = seq
    const blocks = await this.index.getEntriesForRange(seqId, start, end)

    // TODO: do we need to merge or de-duplicate the blocks?

    // fetch all the blocks and parse the feature data
    const features = []
    const blockResults = await Promise.all(
      blocks.map(block => this.getFeaturesInBlock(block)),
    )
    for (let i = 0; i < blockResults.length; i += 1) {
      const blockFeatures = blockResults[i]
      blockFeatures.forEach(feature => {
        if (feature.start < end && feature.end > start) features.push(feature)
      })
    }
    return features
  }

  getFeaturesInBlock({ containerStart, sliceStart, sliceBytes }) {
    return this.cram.getFeaturesFromSlice(
      containerStart,
      sliceStart,
      sliceBytes,
    )
  }
}

module.exports = { CramFile, IndexedCramFile }
