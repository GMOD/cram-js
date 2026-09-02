import { CramMalformedError } from '../../errors.ts'
import { memoizeAsync } from '../memoize.ts'
import CramSlice from '../slice/index.ts'
import { itf8Size, parseItem } from '../util.ts'
import CramContainerCompressionScheme from './compressionScheme.ts'
import { getSectionParsers } from '../sectionParsers.ts'

import type { ReadOpts } from '../../opts.ts'
import type CramFile from '../file.ts'
import type { ReferenceSpan } from '../slice/index.ts'

// A container is built fresh for every query — `CramFile.getContainerAtPosition`
// constructs one rather than looking one up — so the memos below are private to
// one query and a signal can be threaded straight through them. See
// `memoizeAsync` for why that matters, and `CramFile.featureCache` for the one read
// that *is* shared between queries.
export default class CramContainer {
  file: CramFile
  filePosition: number
  private _headerMemo = memoizeAsync((opts?: ReadOpts) =>
    this._fetchHeader(opts),
  )
  private _compressionHeaderBlockMemo = memoizeAsync((opts?: ReadOpts) =>
    this._fetchCompressionHeaderBlock(opts),
  )
  private _compressionSchemeMemo = memoizeAsync((opts?: ReadOpts) =>
    this._fetchCompressionScheme(opts),
  )

  constructor(file: CramFile, filePosition: number) {
    this.file = file
    this.filePosition = filePosition
  }

  getHeader(opts?: ReadOpts) {
    return this._headerMemo(opts)
  }

  private _fetchHeader(opts?: ReadOpts) {
    return this._readContainerHeader(this.filePosition, opts)
  }

  getCompressionHeaderBlock(opts?: ReadOpts) {
    return this._compressionHeaderBlockMemo(opts)
  }

  private async _fetchCompressionHeaderBlock(opts?: ReadOpts) {
    const containerHeader = await this.getHeader(opts)

    // if there are no records in the container, there will be no compression
    // header
    if (!containerHeader.numRecords) {
      return null
    }
    const { majorVersion } = await this.file.getDefinition()
    const sectionParsers = getSectionParsers(majorVersion)

    // The first landmark is where the first slice starts, and the compression
    // header block is everything before it — so its exact length is known and
    // it is one read, where `readBlock` probes the header and reads again.
    const firstLandmark = containerHeader.landmarks[0]
    const block =
      firstLandmark === undefined
        ? await this.getFirstBlock(opts)
        : await this.file.readBlockFromBuffer(
            await this.file.read(
              firstLandmark,
              containerHeader._endPosition,
              opts,
            ),
            0,
            containerHeader._endPosition,
          )
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

  async getFirstBlock(opts?: ReadOpts) {
    const containerHeader = await this.getHeader(opts)
    return this.file.readBlock(containerHeader._endPosition, opts)
  }

  // parses the compression header data into a CramContainerCompressionScheme
  // object
  getCompressionScheme(opts?: ReadOpts) {
    return this._compressionSchemeMemo(opts)
  }

  private async _fetchCompressionScheme(opts?: ReadOpts) {
    const header = await this.getCompressionHeaderBlock(opts)
    if (!header) {
      return undefined
    }

    return new CramContainerCompressionScheme(header.parsedContent)
  }

  /**
   * The slice at `slicePosition`, a byte offset from the end of the container
   * header — a `.crai` `sliceStart`, or one of the header's landmarks. The size
   * comes from the index; leave it out and it is worked out from the landmarks.
   * `span` is the index's word on where the slice's reads lie, which lets the
   * slice start fetching its reference before its own bytes arrive.
   */
  getSlice(slicePosition: number, sliceSize?: number, span?: ReferenceSpan) {
    return new CramSlice(this, slicePosition, sliceSize, span)
  }

  /**
   * How many bytes the slice at `slicePosition` occupies, from the container
   * header: each landmark is where a slice starts, so a slice runs to the next
   * landmark, and the last one to the end of the container's data.
   */
  async getSliceSize(slicePosition: number, opts?: ReadOpts) {
    const { landmarks, length } = await this.getHeader(opts)
    const i = landmarks.indexOf(slicePosition)
    if (i === -1) {
      throw new CramMalformedError(
        `no slice starts at offset ${slicePosition} of the container at ${this.filePosition}`,
      )
    }
    return (landmarks[i + 1] ?? length) - slicePosition
  }

  async _readContainerHeader(position: number, opts?: ReadOpts) {
    const { majorVersion } = await this.file.getDefinition()
    const sectionParsers = getSectionParsers(majorVersion)
    const { cramContainerHeader1, cramContainerHeader2 } = sectionParsers

    // parse the container header. do it in 2 pieces because you cannot tell
    // how much to buffer until you read numLandmarks
    const bytes1 = await this.file.read(
      cramContainerHeader1.maxLength,
      position,
      opts,
    )
    const header1 = parseItem(bytes1, cramContainerHeader1.parser)
    const numLandmarksSize = itf8Size(header1.numLandmarks)

    const bytes2 = await this.file.read(
      cramContainerHeader2.maxLength(header1.numLandmarks),
      position + header1._size - numLandmarksSize,
      opts,
    )
    const header2 = parseItem(bytes2, cramContainerHeader2.parser)

    if (this.file.validateChecksums && header2.crc32 !== undefined) {
      await this.file.checkCrc32(
        position,
        header1._size + header2._size - numLandmarksSize - 4,
        header2.crc32,
        `container header beginning at position ${position}`,
        opts,
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
