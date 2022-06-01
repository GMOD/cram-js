import { unzip } from '../unzip'
import crc32 from 'buffer-crc32'
import LRU from 'quick-lru'
import QuickLRU from 'quick-lru'

import { CramMalformedError, CramUnimplementedError } from '../errors'
import ransuncompress from '../rans'
import {
  BlockHeader,
  CompressionMethod,
  CramCompressionHeader,
  cramFileDefinition as cramFileDefinitionParser,
  getSectionParsers,
} from './sectionParsers'
import htscodecs from '@jkbonfield/htscodecs'
import CramContainer from './container'

import { open } from '../io'
import { parseItem, tinyMemoize } from './util'
import { parseHeaderText } from '../sam'
import { Filehandle } from './filehandle'
import { Int32 } from './int32'
import { Parser } from '@gmod/binary-parser'

//source:https://abdulapopoola.com/2019/01/20/check-endianness-with-javascript/
function getEndianness() {
  const uInt32 = new Uint32Array([0x11223344])
  const uInt8 = new Uint8Array(uInt32.buffer)

  if (uInt8[0] === 0x44) {
    return 0 //little-endian
  } else if (uInt8[0] === 0x11) {
    return 1 //big-endian
  } else {
    return 2 //mixed-endian?
  }
}

type CramFileSource =
  | { url: string; path?: undefined; filehandle?: undefined }
  | { path: string; url?: undefined; filehandle?: undefined }
  | { filehandle: Filehandle; url?: undefined; path?: undefined }

type SeqFetch = (seqId: string, start: number, end: number) => Promise<string>

export type CramFileArgs = CramFileSource & {
  checkSequenceMD5: boolean
  cacheSize?: number
  seqFetch: SeqFetch
}

export type CramFileBlock = BlockHeader & {
  _endPosition: number
  contentPosition: number
  _size: number
  content: Buffer
}

export type ParsedCompressionHeaderCramFileBlock = CramFileBlock & {
  parsedContent: CramCompressionHeader
}

export type ParsedCompressionHeaderCramFileBlock = CramFileBlock & {
  parsedContent: CramCompressionHeader
}

export default class CramFile implements Filehandle {
  private file: Filehandle
  public validateChecksums: boolean
  private fetchReferenceSequenceCallback: SeqFetch
  public options: {
    checkSequenceMD5: boolean
    cacheSize: number
  }
  private featureCache: QuickLRU<unknown, unknown>
  private header: string | undefined

  constructor(args: CramFileArgs) {
    this.file = open(args.url, args.path, args.filehandle)
    this.validateChecksums = true
    this.fetchReferenceSequenceCallback = args.seqFetch
    this.options = {
      checkSequenceMD5: args.checkSequenceMD5,
      cacheSize: args.cacheSize ?? 20000,
    }

    // cache of features in a slice, keyed by the
    // slice offset. caches all of the features in a slice, or none.
    // the cache is actually used by the slice object, it's just
    // kept here at the level of the file
    this.featureCache = new LRU({
      maxSize: this.options.cacheSize,
    })
    if (getEndianness() > 0) {
      throw new Error('Detected big-endian machine, may be unable to run')
    }
  }

  // toString() {
  //   if (this.file.filename) {
  //     return this.file.filename
  //   }
  //   if (this.file.url) {
  //     return this.file.url
  //   }
  //
  //   return '(cram file)'
  // }

  // can just read this object like a filehandle
  read<T extends ArrayBufferView>(
    buffer: T,
    offset: number,
    length: number,
    position: number | bigint | null,
  ): Promise<{ bytesRead: Int32; buffer: T }> {
    return this.file.read<T>(buffer, offset, length, position)
  }

  // can just stat this object like a filehandle
  stat() {
    return this.file.stat()
  }

  // memoized
  async getDefinition() {
    const headbytes = Buffer.allocUnsafe(cramFileDefinitionParser.maxLength)
    await this.file.read(headbytes, 0, cramFileDefinitionParser.maxLength, 0)
    const definition = cramFileDefinitionParser.parser.parse(headbytes)
      .result as any
    if (definition.majorVersion !== 2 && definition.majorVersion !== 3) {
      throw new CramUnimplementedError(
        `CRAM version ${definition.majorVersion} not supported`,
      )
    }
    return definition
  }

  // memoize
  async getSamHeader() {
    const firstContainer = await this.getContainerById(0)
    if (!firstContainer) {
      throw new CramMalformedError('file contains no containers')
    }

    const firstBlock = await firstContainer.getFirstBlock()
    if (firstBlock === undefined) {
      return undefined
    }
    const content = firstBlock.content
    // find the end of the trailing zeros in the header text
    const headerLength = content.readInt32LE(0)
    const textStart = 4
    // let textEnd = content.length - 1
    // while (textEnd >= textStart && !content[textEnd]) textEnd -= 1
    // trim off the trailing zeros
    const text = content.toString('utf8', textStart, textStart + headerLength)
    this.header = text
    return parseHeaderText(text)
  }

  async getHeaderText() {
    await this.getSamHeader()
    return this.header
  }

  // memoize
  async getSectionParsers() {
    const { majorVersion } = await this.getDefinition()
    return getSectionParsers(majorVersion)
  }

  async getContainerById(containerNumber: number) {
    const sectionParsers = await this.getSectionParsers()
    let position = sectionParsers.cramFileDefinition.maxLength
    const { size: fileSize } = await this.file.stat()
    const { cramContainerHeader1 } = sectionParsers

    // skip with a series of reads to the proper container
    let currentContainer
    for (let i = 0; i <= containerNumber; i += 1) {
      // if we are about to go off the end of the file
      // and have not found that container, it does not exist
      if (position + cramContainerHeader1.maxLength + 8 >= fileSize) {
        return undefined
      }

      currentContainer = this.getContainerAtPosition(position)
      const currentHeader = await currentContainer.getHeader()
      if (!currentHeader) {
        throw new CramMalformedError(
          `container ${containerNumber} not found in file`,
        )
      }
      // if this is the first container, read all the blocks in the
      // container to determine its length, because we cannot trust
      // the container header's given length due to a bug somewhere
      // in htslib
      if (i === 0) {
        position = currentHeader._endPosition
        for (let j = 0; j < currentHeader.numBlocks; j += 1) {
          const block = await this.readBlock(position)
          if (block === undefined) {
            return undefined
          }
          position = block._endPosition
        }
      } else {
        // otherwise, just traverse to the next container using the container's length
        position += currentHeader._size + currentHeader.length
      }
    }

    return currentContainer
  }

  async checkCrc32(
    position: number,
    length: number,
    recordedCrc32: number,
    description: string,
  ) {
    const b = Buffer.allocUnsafe(length)
    await this.file.read(b, 0, cramFileDefinitionParser.maxLength, 0)
    const calculatedCrc32 = crc32.unsigned(b)
    if (calculatedCrc32 !== recordedCrc32) {
      throw new CramMalformedError(
        `crc mismatch in ${description}: recorded CRC32 = ${recordedCrc32}, but calculated CRC32 = ${calculatedCrc32}`,
      )
    }
  }

  /**
   * @returns {Promise[number]} the number of containers in the file
   */
  async containerCount(): Promise<number | undefined> {
    const sectionParsers = await this.getSectionParsers()
    const { size: fileSize } = await this.file.stat()
    const { cramContainerHeader1 } = sectionParsers

    let containerCount = 0
    let position = sectionParsers.cramFileDefinition.maxLength
    while (position + cramContainerHeader1.maxLength + 8 < fileSize) {
      const currentHeader = await this.getContainerAtPosition(
        position,
      ).getHeader()
      if (!currentHeader) {
        break
      }
      // if this is the first container, read all the blocks in the
      // container, because we cannot trust the container
      // header's given length due to a bug somewhere in htslib
      if (containerCount === 0) {
        position = currentHeader._endPosition
        for (let j = 0; j < currentHeader.numBlocks; j += 1) {
          const block = await this.readBlock(position)
          if (block === undefined) {
            return undefined
          }
          position = block._endPosition
        }
      } else {
        // otherwise, just traverse to the next container using the container's length
        position += currentHeader._size + currentHeader.length
      }
      containerCount += 1
    }

    return containerCount
  }

  getContainerAtPosition(position: number) {
    return new CramContainer(this, position)
  }

  async readBlockHeader(position: number) {
    const sectionParsers = await this.getSectionParsers()
    const { cramBlockHeader } = sectionParsers
    const { size: fileSize } = await this.file.stat()

    if (position + cramBlockHeader.maxLength >= fileSize) {
      return undefined
    }

    const buffer = Buffer.allocUnsafe(cramBlockHeader.maxLength)
    await this.file.read(buffer, 0, cramFileDefinitionParser.maxLength, 0)
    return parseItem(buffer, cramBlockHeader.parser, 0, position)
  }

  async _parseSection<T>(
    section: { parser: Parser<T>; maxLength: number },
    position: number,
    size = section.maxLength,
    preReadBuffer = undefined,
  ) {
    let buffer
    if (preReadBuffer) {
      buffer = preReadBuffer
    } else {
      const { size: fileSize } = await this.file.stat()
      if (position + size >= fileSize) {
        return undefined
      }
      buffer = Buffer.allocUnsafe(size)
      await this.file.read(buffer, 0, size, position)
    }
    const data = parseItem(buffer, section.parser, 0, position)
    if (data._size !== size) {
      throw new CramMalformedError(
        `section read error: requested size ${size} does not equal parsed size ${data._size}`,
      )
    }
    return data
  }

  _uncompress(
    compressionMethod: CompressionMethod,
    inputBuffer: Buffer,
    outputBuffer: Buffer,
  ) {
    if (compressionMethod === 'gzip') {
      const result = unzip(inputBuffer)
      result.copy(outputBuffer)
    } else if (compressionMethod === 'bzip2') {
      const bits = bzip2.array(inputBuffer)
      let size = bzip2.header(bits)
      let j = 0
      let chunk
      do {
        chunk = bzip2.decompress(bits, size)
        if (chunk != -1) {
          Buffer.from(chunk).copy(outputBuffer, j)
          j += chunk.length
          size -= chunk.length
        }
      } while (chunk != -1)
    } else if (compressionMethod === 'rans') {
      ransuncompress(inputBuffer, outputBuffer)
      //htscodecs r4x8 is slower, but compatible.
      //htscodecs.r4x8_uncompress(inputBuffer, outputBuffer);
    } else if (compressionMethod === 'rans4x16') {
      htscodecs.r4x16_uncompress(inputBuffer, outputBuffer)
    } else if (compressionMethod === 'arith') {
      htscodecs.arith_uncompress(inputBuffer, outputBuffer)
    } else if (compressionMethod === 'fqzcomp') {
      htscodecs.fqzcomp_uncompress(inputBuffer, outputBuffer)
    } else if (compressionMethod === 'tok3') {
      htscodecs.tok3_uncompress(inputBuffer, outputBuffer)
    } else {
      throw new CramUnimplementedError(
        `${compressionMethod} decompression not yet implemented`,
      )
    }
  }

  async readBlock(position: number): Promise<CramFileBlock | undefined> {
    const { majorVersion } = await this.getDefinition()
    const sectionParsers = await this.getSectionParsers()
    const blockHeader = await this.readBlockHeader(position)
    if (blockHeader === undefined) {
      return undefined
    }
    const blockContentPosition = blockHeader._endPosition

    const uncompressedData = Buffer.allocUnsafe(blockHeader.uncompressedSize)

    const block: CramFileBlock = {
      ...blockHeader,
      _endPosition: blockContentPosition,
      contentPosition: blockContentPosition,
      content: uncompressedData,
    }

    if (blockHeader.compressionMethod !== 'raw') {
      const compressedData = Buffer.allocUnsafe(blockHeader.compressedSize)
      await this.read(
        compressedData,
        0,
        blockHeader.compressedSize,
        blockContentPosition,
      )

      this._uncompress(
        blockHeader.compressionMethod,
        compressedData,
        uncompressedData,
      )
    } else {
      await this.read(
        uncompressedData,
        0,
        blockHeader.uncompressedSize,
        blockContentPosition,
      )
    }

    if (majorVersion >= 3) {
      // parse the crc32
      const crc = await this._parseSection(
        sectionParsers.cramBlockCrc32,
        blockContentPosition + blockHeader.compressedSize,
      )
      if (crc === undefined) {
        return undefined
      }

      // check the block data crc32
      if (this.validateChecksums) {
        await this.checkCrc32(
          position,
          blockHeader._size + blockHeader.compressedSize,
          crc.crc32,
          'block data',
        )
      }

      // make the endposition and size reflect the whole block
      block._endPosition = crc._endPosition
      block._size =
        block.compressedSize + sectionParsers.cramBlockCrc32.maxLength
    } else {
      block._endPosition = blockContentPosition + block.compressedSize
      block._size = block.compressedSize
    }

    return block
  }
}

'getDefinition getSectionParsers getSamHeader'
  .split(' ')
  .forEach(method => tinyMemoize(CramFile, method))
