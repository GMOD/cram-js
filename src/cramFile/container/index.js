const sectionParsers = require('../sectionParsers')
const { itf8Size, parseItem } = require('../util')
const CramSlice = require('../slice')
const CramContainerCompressionScheme = require('./compressionScheme')

class CramContainer {
  constructor(cramFile, position) {
    // cram file this container comes from
    this.file = cramFile
    // position of this container in the file
    this.filePosition = position
  }

  getHeader() {
    if (!this._header)
      this._header = this._readContainerHeader(this.filePosition)
    return this._header
  }

  async getCompressionHeaderBlock() {
    if (!this._compressionBlock) {
      const containerHeader = await this.getHeader()
      this._compressionBlock = await this.file.readBlock(
        containerHeader._endPosition,
      )
      if (this._compressionBlock.contentType !== 'COMPRESSION_HEADER')
        throw new Error(
          `invalid content type ${
            this._compressionBlock.contentType
          } in what is supposed to be the compression header block`,
        )
      const content = parseItem(
        this._compressionBlock.content,
        sectionParsers.cramCompressionHeader.parser,
        0,
        this._compressionBlock.contentPosition,
      )
      this._compressionBlock.content = content
    }
    return this._compressionBlock
  }

  // parses the compression header data into a CramContainerCompressionScheme object
  // memoize
  async getCompressionScheme() {
    const header = await this.getCompressionHeaderBlock()
    return new CramContainerCompressionScheme(header.content)
  }

  getSlice(slicePosition, sliceSize) {
    // note: slicePosition is relative to the end of the container header
    // TODO: perhaps we should cache slices?
    return new CramSlice(this, slicePosition, sliceSize)
  }

  async _readContainerHeader(position) {
    const { cramContainerHeader1, cramContainerHeader2 } = sectionParsers
    const { size: fileSize } = await this.file.stat()

    if (position >= fileSize) return undefined

    // parse the container header. do it in 2 pieces because you cannot tell
    // how much to buffer until you read numLandmarks
    const bytes1 = Buffer.allocUnsafe(cramContainerHeader1.maxLength)
    await this.file.read(bytes1, 0, cramContainerHeader1.maxLength, position)
    const header1 = parseItem(bytes1, cramContainerHeader1.parser)
    const numLandmarksSize = itf8Size(header1.numLandmarks)

    const bytes2 = Buffer.allocUnsafe(
      cramContainerHeader2.maxLength(header1.numLandmarks),
    )
    await this.file.read(
      bytes2,
      0,
      cramContainerHeader2.maxLength(header1.numLandmarks),
      position + header1._size - numLandmarksSize,
    )
    const header2 = parseItem(bytes2, cramContainerHeader2.parser)

    if (this.validateChecksums) {
      await this._checkCrc32(
        position,
        header1._size + header2._size - numLandmarksSize - 4,
        header2.crc32,
        `container header beginning at position ${position}`,
      )
    }

    const completeHeader = Object.assign(header1, header2, {
      _size: header1._size + header2._size - numLandmarksSize,
      _endPosition: header1._size + header2._size - numLandmarksSize + position,
    })

    return completeHeader
  }
}

module.exports = CramContainer
