import QuickLRU from '@jbrowse/quick-lru'
import crc32 from 'crc/calculators/crc32'

import { CramMalformedError, CramUnimplementedError } from '../errors.ts'
import * as htscodecs from '../htscodecs/index.ts'
import { open } from '../io.ts'
import { parseHeaderText } from '../sam.ts'
import { decodeUtf8, parseItem } from './util.ts'
import { unzip } from '../unzip.ts'
import CramContainer from './container/index.ts'
import {
  type BlockHeader,
  type CompressionMethod,
  cramFileDefinition,
  getSectionParsers,
} from './sectionParsers.ts'
import { xzDecompress } from '../xz-decompress/xz-decompress.ts'

import type CramRecord from './record.ts'
import type { GenericFilehandle } from 'generic-filehandle2'

// source: https://abdulapopoola.com/2019/01/20/check-endianness-with-javascript/
let isLittleEndian: boolean | undefined
function checkLittleEndian() {
  if (isLittleEndian === undefined) {
    isLittleEndian =
      new Uint8Array(new Uint32Array([0x11223344]).buffer)[0] === 0x44
  }
  return isLittleEndian
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
  validateChecksums?: boolean
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
  private _sectionParsers?: ReturnType<typeof getSectionParsers>
  private _definitionResult?: ReturnType<CramFile['_fetchDefinition']>
  private _samHeaderResult?: ReturnType<CramFile['_fetchSamHeader']>

  constructor(args: CramFileArgs) {
    this.file = open(args.url, args.path, args.filehandle)
    this.validateChecksums = args.validateChecksums ?? false
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
    if (!checkLittleEndian()) {
      throw new Error('Detected big-endian machine, may be unable to run')
    }
  }

  read(length: number, position: number) {
    return this.file.read(length, position)
  }

  private async _getSectionParsers() {
    if (!this._sectionParsers) {
      const { majorVersion } = await this.getDefinition()
      this._sectionParsers = getSectionParsers(majorVersion)
    }
    return this._sectionParsers
  }

  async getDefinition() {
    if (this._definitionResult === undefined) {
      this._definitionResult = this._fetchDefinition()
      this._definitionResult.catch(() => {
        this._definitionResult = undefined
      })
    }
    return this._definitionResult
  }

  private async _fetchDefinition() {
    const { maxLength, parser } = cramFileDefinition()
    const headbytes = await this.file.read(maxLength, 0)
    const definition = parser(headbytes).value
    if (definition.magic !== 'CRAM') {
      throw new Error('Not a CRAM file, does not match magic string')
    } else if (definition.majorVersion !== 2 && definition.majorVersion !== 3) {
      throw new CramUnimplementedError(
        `CRAM version ${definition.majorVersion} not supported`,
      )
    } else {
      return definition
    }
  }

  async getSamHeader() {
    if (this._samHeaderResult === undefined) {
      this._samHeaderResult = this._fetchSamHeader()
      this._samHeaderResult.catch(() => {
        this._samHeaderResult = undefined
      })
    }
    return this._samHeaderResult
  }

  private async _fetchSamHeader() {
    const firstContainer = await this.getContainerById(0)
    if (!firstContainer) {
      throw new CramMalformedError('file contains no containers')
    }

    const firstBlock = await firstContainer.getFirstBlock()

    const content = firstBlock.content
    const dataView = new DataView(
      content.buffer,
      content.byteOffset,
      content.byteLength,
    )
    const headerLength = dataView.getInt32(0, true)
    const textStart = 4
    const text = decodeUtf8(
      content.subarray(textStart, textStart + headerLength),
    )
    this.header = text
    return parseHeaderText(text)
  }

  async getHeaderText() {
    await this.getSamHeader()
    return this.header
  }

  // Walk containers from the start of the file. Yields each container along
  // with its parsed header. The first container's length is recomputed by
  // reading all of its blocks because the recorded length cannot be trusted
  // (htslib bug); subsequent containers use header._size + header.length.
  private async *iterContainers() {
    const sectionParsers = await this._getSectionParsers()
    let position = sectionParsers.cramFileDefinition.maxLength
    let i = 0
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const container = this.getContainerAtPosition(position)
      const header = await container.getHeader()
      yield container
      if (i === 0) {
        position = header._endPosition
        for (let j = 0; j < header.numBlocks; j++) {
          const block = await this.readBlock(position)
          position = block._endPosition
        }
      } else {
        position += header._size + header.length
      }
      i++
    }
  }

  async getContainerById(containerNumber: number) {
    let i = 0
    for await (const container of this.iterContainers()) {
      if (i === containerNumber) {
        return container
      }
      i++
    }
    return undefined
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
    let containerCount = 0
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _container of this.iterContainers()) {
        containerCount += 1
      }
    } catch (e) {
      containerCount--
    }
    return containerCount
  }

  getContainerAtPosition(position: number) {
    return new CramContainer(this, position)
  }

  async readBlockHeader(
    position: number,
  ): Promise<BlockHeader & { _endPosition: number; _size: number }> {
    const { cramBlockHeader } = await this._getSectionParsers()

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
  ): Promise<T & { _endPosition: number; _size: number }> {
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
      return await unzip(inputBuffer)
    } else if (compressionMethod === 'bzip2') {
      return await htscodecs.bz2_uncompress(inputBuffer, uncompressedSize)
    } else if (compressionMethod === 'lzma') {
      return xzDecompress(inputBuffer)
    } else if (compressionMethod === 'rans') {
      return await htscodecs.rans_uncompress(inputBuffer)
    } else if (compressionMethod === 'rans4x16') {
      return await htscodecs.r4x16_uncompress(inputBuffer)
    } else if (compressionMethod === 'arith') {
      return await htscodecs.arith_uncompress(inputBuffer)
    } else if (compressionMethod === 'fqzcomp') {
      return await htscodecs.fqzcomp_uncompress(inputBuffer)
    } else if (compressionMethod === 'tok3') {
      return await htscodecs.tok3_uncompress(inputBuffer)
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
    const { cramBlockHeader, cramBlockCrc32 } = await this._getSectionParsers()

    const headerBuf = await this.file.read(cramBlockHeader.maxLength, position)
    const blockHeader = parseItem(
      headerBuf,
      cramBlockHeader.parser,
      0,
      position,
    )

    const totalSize =
      blockHeader._size +
      blockHeader.compressedSize +
      (majorVersion >= 3 ? cramBlockCrc32.maxLength : 0)
    const fullBuffer = await this.file.read(totalSize, position)

    return this.readBlockFromBuffer(fullBuffer, 0, position)
  }

  async readBlockFromBuffer(
    buffer: Uint8Array,
    bufferOffset: number,
    filePosition: number,
  ) {
    const { majorVersion } = await this.getDefinition()
    const sectionParsers = await this._getSectionParsers()
    const { cramBlockHeader } = sectionParsers

    const headerBytes = buffer.subarray(
      bufferOffset,
      bufferOffset + cramBlockHeader.maxLength,
    )
    const blockHeader = parseItem(
      headerBytes,
      cramBlockHeader.parser,
      0,
      filePosition,
    )
    const blockContentPosition = blockHeader._endPosition
    const contentOffset = bufferOffset + blockHeader._size

    const d = buffer.subarray(
      contentOffset,
      contentOffset + blockHeader.compressedSize,
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
      const crcOffset = contentOffset + blockHeader.compressedSize
      const crcBytes = buffer.subarray(
        crcOffset,
        crcOffset + sectionParsers.cramBlockCrc32.maxLength,
      )
      const crc = parseItem(
        crcBytes,
        sectionParsers.cramBlockCrc32.parser,
        0,
        blockContentPosition + blockHeader.compressedSize,
      )
      block.crc32 = crc.crc32

      if (this.validateChecksums) {
        const blockData = buffer.subarray(
          bufferOffset,
          bufferOffset + blockHeader._size + blockHeader.compressedSize,
        )
        const calculatedCrc32 = crc32(blockData) >>> 0
        if (calculatedCrc32 !== crc.crc32) {
          throw new CramMalformedError(
            `crc mismatch in block data: recorded CRC32 = ${crc.crc32}, but calculated CRC32 = ${calculatedCrc32}`,
          )
        }
      }

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
