const crc32 = require('buffer-crc32')

const sectionParsers = require('./sectionParsers')

const CramContainer = require('./container')

const { parseItem } = require('./util')

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

  // can just stat this object like a filehandle
  stat() {
    return this.file.stat()
  }

  async getDefinition() {
    const { cramFileDefinition } = sectionParsers
    const headbytes = Buffer.allocUnsafe(cramFileDefinition.maxLength)
    await this.file.read(headbytes, 0, cramFileDefinition.maxLength, 0)
    return cramFileDefinition.parser.parse(headbytes).result
  }

  async getContainerByID(containerNumber) {
    let offset = sectionParsers.cramFileDefinition.maxLength
    const { size: fileSize } = await this.file.stat()
    const { cramContainerHeader1 } = sectionParsers

    // skip with a series of reads to the proper container
    let currentContainer
    for (
      let i = 0;
      i <= containerNumber &&
      offset + cramContainerHeader1.maxLength + 8 < fileSize;
      i += 1
    ) {
      currentContainer = this.getContainerAtOffset(offset)
      const currentHeader = await currentContainer.getHeader()
      offset += currentHeader._size + currentHeader.length
    }

    return currentContainer
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
      const currentHeader = await this.getContainerAtOffset(offset).getHeader()
      offset += currentHeader._size + currentHeader.length
    }

    return i + 1
  }

  getContainerAtOffset(offset) {
    return new CramContainer(this, offset)
  }

  async readBlockHeader(offset) {
    const { cramBlockHeader } = sectionParsers
    const { size: fileSize } = await this.file.stat()

    if (offset >= fileSize) return undefined

    const buffer = Buffer.allocUnsafe(cramBlockHeader.maxLength)
    await this.file.read(buffer, 0, cramBlockHeader.maxLength, offset)
    return parseItem(buffer, cramBlockHeader.parser, 0, offset)
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
    const data = parseItem(buffer, section.parser, 0, offset)
    if (data._size !== size)
      throw new Error(
        `section read error: requested size ${size} does not equal parsed size ${
          data._size
        }`,
      )
    return data
  }

  async readBlock(offset) {
    const block = await this.readBlockHeader(offset)
    const blockContentOffset = block._endOffset

    if (block.contentType === 'FILE_HEADER') {
      throw new Error('FILE_HEADER not yet implemented')
    } else if (block.contentType === 'COMPRESSION_HEADER') {
      if (block.compressionMethod !== 'raw')
        throw new Error(
          `invalid ${
            block.compressionMethod
          } compression method for COMPRESSION_HEADER block`,
        )
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
          `${block.compressionMethod} decompression not yet implemented`,
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
    } else {
      throw new Error(`unknown block content type "${block.contentType}"`)
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

    // make the endoffset and size reflect the whole block
    block._endOffset = crc._endOffset
    block._size = block.compressedSize + sectionParsers.cramBlockCrc32.maxLength

    return block
  }
}

module.exports = CramFile
