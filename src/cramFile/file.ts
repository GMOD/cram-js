import crc32 from 'crc/calculators/crc32'
import QuickLRU from 'quick-lru'
import { XzReadableStream } from 'xz-decompress'

import { CramMalformedError, CramUnimplementedError } from '../errors'
import * as htscodecs from '../htscodecs'
import { open } from '../io'
import ransuncompress from '../rans'
import { parseHeaderText } from '../sam'
import { decode } from '../seek-bzip'
import { unzip } from '../unzip'
import CramContainer from './container'
import CramRecord from './record'
import {
  BlockHeader,
  CompressionMethod,
  cramFileDefinition,
  getSectionParsers,
} from './sectionParsers'
import { parseItem, tinyMemoize } from './util'

import type { GenericFilehandle } from 'generic-filehandle2'

function bufferToStream(buf: Uint8Array) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(buf)
      controller.close()
    },
  })
}

// source: https://abdulapopoola.com/2019/01/20/check-endianness-with-javascript/
function getEndianness() {
  const uInt32 = new Uint32Array([0x11223344])
  const uInt8 = new Uint8Array(uInt32.buffer)

  if (uInt8[0] === 0x44) {
    return 0 // little-endian
  } else if (uInt8[0] === 0x11) {
    return 1 // big-endian
  } else {
    return 2 // mixed-endian?
  }
}

export interface CramFileSource {
  filehandle?: GenericFilehandle
  url?: string
  path?: string
}

export type SeqFetch = (
  seqId: number,
  start: number,
  end: number,
) => Promise<string>

export type CramFileArgs = CramFileSource & {
  checkSequenceMD5?: boolean
  cacheSize?: number
  seqFetch?: SeqFetch
}

export type CramFileBlock = BlockHeader & {
  _endPosition: number
  contentPosition: number
  _size: number
  content: Uint8Array
  crc32?: number
}

export default class CramFile {
  private file: GenericFilehandle
  public validateChecksums: boolean
  public fetchReferenceSequenceCallback?: SeqFetch
  public options: {
    checkSequenceMD5?: boolean
    cacheSize: number
  }
  public featureCache: QuickLRU<string, Promise<CramRecord[]>>
  private header: string | undefined

  constructor(args: CramFileArgs) {
    this.file = open(args.url, args.path, args.filehandle)
    this.validateChecksums = true
    this.fetchReferenceSequenceCallback = args.seqFetch
    this.options = {
      checkSequenceMD5: args.checkSequenceMD5,
      cacheSize: args.cacheSize ?? 20000,
    }

    // cache of features in a slice, keyed by the slice offset. caches all of
    // the features in a slice, or none. the cache is actually used by the
    // slice object, it's just kept here at the level of the file
    this.featureCache = new QuickLRU({
      maxSize: this.options.cacheSize,
    })
    if (getEndianness() > 0) {
      throw new Error('Detected big-endian machine, may be unable to run')
    }
  }

  read(length: number, position: number) {
    return this.file.read(length, position)
  }

  // memoized
  async getDefinition() {
    const { maxLength, parser } = cramFileDefinition()
    const headbytes = await this.file.read(maxLength, 0)
    const definition = parser(headbytes).value
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

    const content = firstBlock.content
    const dataView = new DataView(content.buffer)
    const headerLength = dataView.getInt32(0, true)
    const textStart = 4
    const decoder = new TextDecoder('utf8')
    const text = decoder.decode(
      content.subarray(textStart, textStart + headerLength),
    )
    this.header = text
    return parseHeaderText(text)
  }

  async getHeaderText() {
    await this.getSamHeader()
    return this.header
  }

  async getContainerById(containerNumber: number) {
    const { majorVersion } = await this.getDefinition()
    const sectionParsers = getSectionParsers(majorVersion)
    let position = sectionParsers.cramFileDefinition.maxLength

    // skip with a series of reads to the proper container
    let currentContainer: CramContainer | undefined
    for (let i = 0; i <= containerNumber; i++) {
      // if we are about to go off the end of the file
      // and have not found that container, it does not exist
      // if (position + cramContainerHeader1.maxLength + 8 >= fileSize) {
      //   return undefined
      // }

      currentContainer = this.getContainerAtPosition(position)
      const currentHeader = await currentContainer.getHeader()

      // if this is the first container, read all the blocks in the container
      // to determine its length, because we cannot trust the container
      // header's given length due to a bug somewhere in htslib
      if (i === 0) {
        position = currentHeader._endPosition
        for (let j = 0; j < currentHeader.numBlocks; j++) {
          const block = await this.readBlock(position)
          position = block._endPosition
        }
      } else {
        // otherwise, just traverse to the next container using the container's
        // length
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
    const b = await this.file.read(length, position)
    // this shift >>> 0 is equivalent to crc32(b).unsigned but uses the
    // internal calculator of crc32 to avoid accidentally importing buffer
    // https://github.com/alexgorbatchev/crc/blob/31fc3853e417b5fb5ec83335428805842575f699/src/define_crc.ts#L5
    const calculatedCrc32 = crc32(b) >>> 0
    if (calculatedCrc32 !== recordedCrc32) {
      throw new CramMalformedError(
        `crc mismatch in ${description}: recorded CRC32 = ${recordedCrc32}, but calculated CRC32 = ${calculatedCrc32}`,
      )
    }
  }

  /**
   * @returns {Promise[number]} the number of containers in the file
   *
   * note: this is currently used only in unit tests, and after removing file
   * length check, relies on a try catch to read return an error to break
   */
  async containerCount(): Promise<number | undefined> {
    const { majorVersion } = await this.getDefinition()
    const sectionParsers = getSectionParsers(majorVersion)

    let containerCount = 0
    let position = sectionParsers.cramFileDefinition.maxLength
    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        const currentHeader =
          await this.getContainerAtPosition(position).getHeader()

        // if this is the first container, read all the blocks in the container,
        // because we cannot trust the container header's given length due to a
        // bug somewhere in htslib
        if (containerCount === 0) {
          position = currentHeader._endPosition
          for (let j = 0; j < currentHeader.numBlocks; j++) {
            const block = await this.readBlock(position)
            position = block._endPosition
          }
        } else {
          // otherwise, just traverse to the next container using the container's
          // length
          position += currentHeader._size + currentHeader.length
        }
        containerCount += 1
      }
    } catch (e) {
      containerCount--
      /* do nothing */
    }

    return containerCount
  }

  getContainerAtPosition(position: number) {
    return new CramContainer(this, position)
  }

  async readBlockHeader(position: number) {
    const { majorVersion } = await this.getDefinition()
    const sectionParsers = getSectionParsers(majorVersion)
    const { cramBlockHeader } = sectionParsers

    const buffer = await this.file.read(cramBlockHeader.maxLength, position)
    return parseItem(buffer, cramBlockHeader.parser, 0, position)
  }

  async _parseSection<T>(
    section: {
      maxLength: number
      parser: (
        buffer: Uint8Array,
        offset: number,
      ) => { offset: number; value: T }
    },
    position: number,
    size = section.maxLength,
    preReadBuffer?: Uint8Array,
  ) {
    const buffer = preReadBuffer ?? (await this.file.read(size, position))
    const data = parseItem(buffer, section.parser, 0, position)
    if (data._size !== size) {
      throw new CramMalformedError(
        `section read error: requested size ${size} does not equal parsed size ${data._size}`,
      )
    }
    return data
  }

  async _uncompressPre(
    compressionMethod: CompressionMethod,
    inputBuffer: Uint8Array,
    uncompressedSize: number,
  ) {
    // console.log({ compressionMethod })
    if (compressionMethod === 'gzip') {
      return unzip(inputBuffer)
    } else if (compressionMethod === 'bzip2') {
      return decode(inputBuffer)
    } else if (compressionMethod === 'lzma') {
      const decompressedResponse = new Response(
        new XzReadableStream(bufferToStream(inputBuffer)),
      )
      return new Uint8Array(await decompressedResponse.arrayBuffer())
    } else if (compressionMethod === 'rans') {
      const outputBuffer = new Uint8Array(uncompressedSize)
      ransuncompress(inputBuffer, outputBuffer)
      return outputBuffer
    } else if (compressionMethod === 'rans4x16') {
      return htscodecs.r4x16_uncompress(inputBuffer)
    } else if (compressionMethod === 'arith') {
      return htscodecs.arith_uncompress(inputBuffer)
    } else if (compressionMethod === 'fqzcomp') {
      return htscodecs.fqzcomp_uncompress(inputBuffer)
    } else if (compressionMethod === 'tok3') {
      return htscodecs.tok3_uncompress(inputBuffer)
    } else {
      throw new CramUnimplementedError(
        `${compressionMethod} decompression not yet implemented`,
      )
    }
  }

  async _uncompress(
    compressionMethod: CompressionMethod,
    inputBuffer: Uint8Array,
    uncompressedSize: number,
  ) {
    const buf = await this._uncompressPre(
      compressionMethod,
      inputBuffer,
      uncompressedSize,
    )
    if (buf.length !== uncompressedSize) {
      const ret = new Uint8Array(uncompressedSize)
      ret.set(buf, 0)
      return ret
    }
    return buf
  }

  async readBlock(position: number) {
    const { majorVersion } = await this.getDefinition()
    const sectionParsers = getSectionParsers(majorVersion)
    const blockHeader = await this.readBlockHeader(position)
    const blockContentPosition = blockHeader._endPosition

    const d = await this.file.read(
      blockHeader.compressedSize,
      blockContentPosition,
    )
    const uncompressedData =
      blockHeader.compressionMethod !== 'raw'
        ? await this._uncompress(
            blockHeader.compressionMethod,
            d,
            blockHeader.uncompressedSize,
          )
        : d

    const block: CramFileBlock = {
      ...blockHeader,
      _endPosition: blockContentPosition,
      contentPosition: blockContentPosition,
      content: uncompressedData,
    }
    if (majorVersion >= 3) {
      // parse the crc32
      const crc = await this._parseSection(
        sectionParsers.cramBlockCrc32,
        blockContentPosition + blockHeader.compressedSize,
      )
      block.crc32 = crc.crc32

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

'getDefinition getSectionParsers getSamHeader'.split(' ').forEach(method => {
  tinyMemoize(CramFile, method)
})
