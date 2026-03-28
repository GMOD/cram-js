import { CramMalformedError } from '../../errors.ts'
import CramSlice from '../slice/index.ts'
import { itf8Size, parseItem } from '../util.ts'
import CramContainerCompressionScheme from './compressionScheme.ts'
import { getSectionParsers } from '../sectionParsers.ts'

import type CramFile from '../file.ts'

export default class CramContainer {
  file: CramFile
  filePosition: number
  private _headerResult?: ReturnType<CramContainer['_fetchHeader']>
  private _compressionHeaderBlockResult?: ReturnType<
    CramContainer['_fetchCompressionHeaderBlock']
  >
  private _compressionSchemeResult?: ReturnType<
    CramContainer['_fetchCompressionScheme']
  >

  constructor(file: CramFile, filePosition: number) {
    this.file = file
    this.filePosition = filePosition
  }

  getHeader() {
    if (this._headerResult === undefined) {
      this._headerResult = this._fetchHeader()
      this._headerResult.catch(() => {
        this._headerResult = undefined
      })
    }
    return this._headerResult
  }

  private _fetchHeader() {
    return this._readContainerHeader(this.filePosition)
  }

  async getCompressionHeaderBlock() {
    if (this._compressionHeaderBlockResult === undefined) {
      this._compressionHeaderBlockResult =
        this._fetchCompressionHeaderBlock()
      this._compressionHeaderBlockResult.catch(() => {
        this._compressionHeaderBlockResult = undefined
      })
    }
    return this._compressionHeaderBlockResult
  }

  private async _fetchCompressionHeaderBlock() {
    const containerHeader = await this.getHeader()

    // if there are no records in the container, there will be no compression
    // header
    if (!containerHeader.numRecords) {
      return null
    }
    const { majorVersion } = await this.file.getDefinition()
    const sectionParsers = getSectionParsers(majorVersion)

    const block = await this.getFirstBlock()
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
    return this.file.readBlock(containerHeader._endPosition)
  }

  // parses the compression header data into a CramContainerCompressionScheme
  // object
  async getCompressionScheme() {
    if (this._compressionSchemeResult === undefined) {
      this._compressionSchemeResult = this._fetchCompressionScheme()
      this._compressionSchemeResult.catch(() => {
        this._compressionSchemeResult = undefined
      })
    }
    return this._compressionSchemeResult
  }

  private async _fetchCompressionScheme() {
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

    // parse the container header. do it in 2 pieces because you cannot tell
    // how much to buffer until you read numLandmarks
    const bytes1 = await this.file.read(
      cramContainerHeader1.maxLength,
      position,
    )
    const header1 = parseItem(bytes1, cramContainerHeader1.parser)
    const numLandmarksSize = itf8Size(header1.numLandmarks)

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

    return {
      ...header1,
      ...header2,
      _size: header1._size + header2._size - numLandmarksSize,
      _endPosition: header1._size + header2._size - numLandmarksSize + position,
    }
  }
}
