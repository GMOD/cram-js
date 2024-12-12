import { CramMalformedError } from '../../errors'
// locals
import { itf8Size, parseItem, tinyMemoize } from '../util'
import CramSlice from '../slice'
import CramContainerCompressionScheme from './compressionScheme'
import CramFile from '../file'
import { getSectionParsers } from '../sectionParsers'

export default class CramContainer {
  constructor(
    public file: CramFile,
    public filePosition: number,
  ) {}

  getHeader() {
    return this._readContainerHeader(this.filePosition)
  }

  async getCompressionHeaderBlock() {
    const containerHeader = await this.getHeader()

    // if there are no records in the container, there will be no compression
    // header
    if (!containerHeader?.numRecords) {
      return null
    }
    const { majorVersion } = await this.file.getDefinition()
    const sectionParsers = getSectionParsers(majorVersion)

    const block = await this.getFirstBlock()
    if (block === undefined) {
      return undefined
    }
    if (block.contentType !== 'COMPRESSION_HEADER') {
      throw new CramMalformedError(
        `invalid content type ${block.contentType} in compression header block`,
      )
    }

    const content = parseItem(
      block.content,
      sectionParsers.cramCompressionHeader.parser,
      0,
      block.contentPosition,
    )
    return {
      ...block,
      parsedContent: content,
    }
  }

  async getFirstBlock() {
    const containerHeader = await this.getHeader()
    if (!containerHeader) {
      return undefined
    }
    return this.file.readBlock(containerHeader._endPosition)
  }

  // parses the compression header data into a CramContainerCompressionScheme
  // object
  async getCompressionScheme() {
    const header = await this.getCompressionHeaderBlock()
    if (!header) {
      return undefined
    }

    return new CramContainerCompressionScheme(header.parsedContent)
  }

  getSlice(slicePosition: number, sliceSize: number) {
    // note: slicePosition is relative to the end of the container header
    // TODO: perhaps we should cache slices?
    return new CramSlice(this, slicePosition, sliceSize)
  }

  async _readContainerHeader(position: number) {
    const { majorVersion } = await this.file.getDefinition()
    const sectionParsers = getSectionParsers(majorVersion)
    const { cramContainerHeader1, cramContainerHeader2 } = sectionParsers
    const { size: fileSize } = await this.file.stat()

    if (position >= fileSize) {
      console.warn(`pos:${position}>=fileSize:${fileSize} in cram container`)
      return undefined
    }

    // parse the container header. do it in 2 pieces because you cannot tell
    // how much to buffer until you read numLandmarks
    const bytes1 = await this.file.read(
      cramContainerHeader1.maxLength,
      position,
    )
    const header1 = parseItem(bytes1, cramContainerHeader1.parser)
    const numLandmarksSize = itf8Size(header1.numLandmarks)
    if (position + header1.length >= fileSize) {
      // header indicates container goes beyond fileSize
      console.warn(
        `container at ${position} is beyond fileSize:${fileSize}, skipping`,
      )
      return undefined
    }

    const bytes2 = await this.file.read(
      cramContainerHeader2.maxLength(header1.numLandmarks),
      position + header1._size - numLandmarksSize,
    )
    const header2 = parseItem(bytes2, cramContainerHeader2.parser)

    if (this.file.validateChecksums && header2.crc32 !== undefined) {
      await this.file.checkCrc32(
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

'getHeader getCompressionHeaderBlock getCompressionScheme'
  .split(' ')
  .forEach(method => {
    tinyMemoize(CramContainer, method)
  })
