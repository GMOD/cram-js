const url = require('url')
const crc32 = require('buffer-crc32')

const { LocalFile, RemoteFile } = require('./io')
const sectionParsers = require('./sectionParsers')

const { itf8Size } = require('./cramTypes')

class CramFile {
  constructor(source) {
    const { protocol, pathname } = url.parse(source)
    if (protocol === 'file:') {
      this.file = new LocalFile(unescape(pathname))
    } else {
      this.file = new RemoteFile(source)
    }

    this.validateChecksums = true
  }

  // async _readSection(offset, parser, maxLength) {
  //   const bytes = Buffer.allocUnsafe(maxLength)
  //   await this.file.read(bytes, 0, maxLength, offset)
  //   return parser.parse(bytes)
  // }

  async definition() {
    const { cramFileDefinition } = sectionParsers
    const headbytes = Buffer.allocUnsafe(cramFileDefinition.maxLength)
    await this.file.read(headbytes, 0, cramFileDefinition.maxLength, 0)
    return cramFileDefinition.parser.parse(headbytes).result
  }

  async containerHeader(containerNumber) {
    let offset = sectionParsers.cramFileDefinition.maxLength
    const fileSize = await this.file.size()
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
    const fileSize = await this.file.size()

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
    const fileSize = await this.file.size()
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
    const fileSize = await this.file.size()

    if (offset >= fileSize) return undefined

    const buffer = Buffer.allocUnsafe(cramBlockHeader.maxLength)
    await this.file.read(buffer, 0, cramBlockHeader.maxLength, offset)
    return this.constructor._parse(buffer, cramBlockHeader.parser, 0, offset)
  }

  async readCompressionHeader(offset, size) {
    const { cramCompressionHeader } = sectionParsers
    const fileSize = await this.file.size()

    if (offset + size >= fileSize) return undefined

    const buffer = Buffer.allocUnsafe(size)
    await this.file.read(buffer, 0, size, offset)
    const data = this.constructor._parse(
      buffer,
      cramCompressionHeader.parser,
      0,
      offset,
    )
    if (data._size !== size)
      throw new Error(
        `unknown compression header parse error: requested size ${size} does not equal returned size ${
          data._size
        }`,
      )
    return data
  }
}

class IndexedCramFile {
  //  constructor({ cram, crai, fasta, fai }) {}
}

module.exports = { CramFile, IndexedCramFile }
