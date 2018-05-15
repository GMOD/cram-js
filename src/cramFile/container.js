const sectionParsers = require('./sectionParsers')
const { itf8Size, parseItem } = require('./util')
const CramSlice = require('./slice')

class CramContainer {
  constructor(cramFile, offset) {
    // cram file this container comes from
    this.file = cramFile
    // offset of this container in the file
    this.fileOffset = offset
  }

  getHeader() {
    if (!this._header) this._header = this._readContainerHeader(this.fileOffset)
    return this._header
  }

  async getCompressionBlock() {
    if (!this._compressionBlock) {
      const containerHeader = await this.getHeader()
      this._compressionBlock = this.file.readBlock(containerHeader._endOffset)
    }
    return this._compressionBlock
  }

  getSlice(sliceOffset, sliceSize) {
    // note: sliceOffset is relative to the end of the container header
    // TODO: perhaps we should cache slices?
    return new CramSlice(this, sliceOffset, sliceSize)
  }

  async _readContainerHeader(offset) {
    const { cramContainerHeader1, cramContainerHeader2 } = sectionParsers
    const { size: fileSize } = await this.file.stat()

    if (offset >= fileSize) return undefined

    // parse the container header. do it in 2 pieces because you cannot tell
    // how much to buffer until you read numLandmarks
    const bytes1 = Buffer.allocUnsafe(cramContainerHeader1.maxLength)
    await this.file.read(bytes1, 0, cramContainerHeader1.maxLength, offset)
    const header1 = parseItem(bytes1, cramContainerHeader1.parser)
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
    const header2 = parseItem(bytes2, cramContainerHeader2.parser)

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
}

module.exports = CramContainer
