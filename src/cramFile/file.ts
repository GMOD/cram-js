import { SharedReadCache } from '@gmod/shared-read-cache'
import crc32 from 'crc/calculators/crc32'

import {
  CramArgumentError,
  CramMalformedError,
  CramUnimplementedError,
} from '../errors.ts'
import * as htscodecs from '../htscodecs/index.ts'
import { open } from '../io.ts'
import { memoizeAsync } from './memoize.ts'
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
import type { BaseOpts, ReadOpts } from '../opts.ts'
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

/**
 * Fetch reference bases for `[start, end)` — 0-based half-open, so the returned
 * string must be exactly `end - start` characters. Both call sites check that
 * length, which is what turns a callback still written against the pre-v10
 * 1-based closed contract into an error rather than bases shifted by one.
 *
 * `refName` is the `@SQ` `SN` for `seqId`, so a callback can hand coordinates
 * straight to a name-keyed sequence source instead of the caller maintaining
 * its own id->name table. Only `undefined` for a CRAM with no `@SQ` lines.
 *
 * `opts.signal` is the signal of the query that needs these bases, for a
 * callback whose sequence source is itself remote. Ignoring it is fine — the
 * query still rejects on abort, at the next point the decode checks — so a
 * four-argument callback written before v10.6 keeps working unchanged.
 */
export type SeqFetch = (
  seqId: number,
  start: number,
  end: number,
  refName: string | undefined,
  opts?: BaseOpts,
) => Promise<string>

/** One `@SQ` line of the SAM header. */
export interface ReferenceInfo {
  /** `SN` */
  name: string
  /** `LN` */
  length: number
  /** `M5`, when the header records one */
  md5?: string
}

function parseReferenceInfo(
  header: ReturnType<typeof parseHeaderText>,
): ReferenceInfo[] {
  return header
    .filter(line => line.tag === 'SQ')
    .map((line, refId) => {
      const name = line.data.find(item => item.tag === 'SN')?.value
      const length = line.data.find(item => item.tag === 'LN')?.value
      if (name === undefined || length === undefined) {
        throw new CramMalformedError(
          `@SQ line ${refId} is missing its ${name === undefined ? 'SN' : 'LN'} tag`,
        )
      }
      return {
        name,
        length: Number(length),
        md5: line.data.find(item => item.tag === 'M5')?.value,
      }
    })
}

export type CramFileArgs = CramFileSource & {
  /**
   * Verify each slice's recorded reference MD5 against the sequence it is being
   * decoded with. Default false — the check needs the slice's whole reference
   * span, which can be many megabases the query would not otherwise fetch.
   */
  checkSequenceMD5?: boolean
  cacheSize?: number
  fetchReferenceSequence?: SeqFetch
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
    checkSequenceMD5: boolean
    cacheSize: number
  }
  public featureCache: SharedReadCache<string, CramRecord[]>
  private header: string | undefined
  // Deliberately signal-free, unlike every other memo in the read path. These
  // two are shared file-wide and fetched once for the life of the object — 26
  // bytes of definition, and the first container for the SAM header — so every
  // query after the first joins them already resolved. Threading a signal in
  // would mean the first query to arrive owns a read the whole file depends on,
  // and cancelling it on that one query's behalf is wrong however carefully the
  // sharing is handled.
  private _definitionMemo = memoizeAsync(() => this._fetchDefinition())
  private _samHeaderMemo = memoizeAsync(() => this._fetchSamHeader())
  private _referenceInfo?: ReferenceInfo[]

  constructor(args: CramFileArgs) {
    this.file = open(args.url, args.path, args.filehandle)
    this.validateChecksums = args.validateChecksums ?? false
    this.fetchReferenceSequenceCallback = args.fetchReferenceSequence
    this.options = {
      // off unless asked for: the check needs the whole span a slice was
      // written against, which for a big slice is many megabases the query
      // itself would never have fetched
      checkSequenceMD5: args.checkSequenceMD5 ?? false,
      cacheSize: args.cacheSize ?? 20000,
    }

    // cache of features in a slice, keyed by the slice offset. caches all of
    // the features in a slice, or none. the cache is actually used by the
    // slice object, it's just kept here at the level of the file
    this.featureCache = new SharedReadCache<string, CramRecord[]>({
      maxSize: this.options.cacheSize,
      // records, not bytes: there is no cheap way to size a decoded record, and
      // a record count at least makes the documented contract true
      sizeOf: records => records.length,
      // A range starts every one of its slices at once and holds all of their
      // records until it returns, so evicting one mid-query frees nothing but
      // does guarantee the next identical query re-decodes it. Measured at
      // 117ms against 12ms on a repeated 55,000-record range (ADR 0003).
      evictionPolicy: 'batch',
    })
    if (!checkLittleEndian()) {
      throw new Error('Detected big-endian machine, may be unable to run')
    }
  }

  /**
   * Every byte the decode reads comes through here.
   *
   * The signal is checked before the read is issued as well as handed to the
   * filehandle, because honouring it is optional down there: `RemoteFile`
   * aborts the `fetch`, but `LocalFile` ignores the signal entirely and runs to
   * completion. The up-front check is what makes a cancelled query stop making
   * progress on a local file rather than reading the whole range anyway.
   */
  read(length: number, position: number, opts?: ReadOpts) {
    opts?.signal?.throwIfAborted()
    return this.file.read(length, position, opts)
  }

  // getSectionParsers is itself cached per major version — the parsers are pure
  // functions of (buffer, offset), so one set is shared by every file — which
  // is why there is no memo of its result here
  private async _getSectionParsers() {
    const { majorVersion } = await this.getDefinition()
    return getSectionParsers(majorVersion)
  }

  getDefinition() {
    return this._definitionMemo()
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

  getSamHeader() {
    return this._samHeaderMemo()
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

  /**
   * The `@SQ` lines in header order. A reference's numeric ID — what
   * `getRecordsForRange` takes and `CramRecord.sequenceId` reports — is its
   * index here. Empty for a CRAM with no `@SQ` lines.
   */
  async getReferenceInfo() {
    this._referenceInfo ??= parseReferenceInfo(await this.getSamHeader())
    return this._referenceInfo
  }

  /**
   * Numeric ID for a reference name. Throws if the header has no such `SN` —
   * a name that is not in the file is a caller mistake, and returning `-1`
   * would collide with the ID unplaced reads use. Use `getReferenceInfo()` to
   * test for a name without throwing.
   */
  async getReferenceId(name: string) {
    const refId = (await this.getReferenceInfo()).findIndex(
      ref => ref.name === name,
    )
    if (refId === -1) {
      throw new CramArgumentError(
        `no @SQ line in the CRAM header named ${name}`,
      )
    }
    return refId
  }

  /**
   * Reference name for a numeric ID. Undefined for an ID with no `@SQ` line,
   * which is routine rather than a mistake: `-1` means unplaced, and a CRAM
   * with no `@SQ` lines at all has no names to give.
   */
  async getReferenceName(refId: number) {
    return (await this.getReferenceInfo())[refId]?.name
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
    opts?: ReadOpts,
  ) {
    const b = await this.read(length, position, opts)
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
   * How many containers the file holds, not counting the EOF marker container.
   *
   * Nothing in a CRAM records this, so it is a walk from the start, and there
   * is no length to bound the walk either — it ends when a container fails to
   * parse, which is what reading past the end of the file looks like. The EOF
   * marker parses like any other container, so it is walked and then
   * subtracted: the number left is how many containers hold data, which is what
   * `getContainerById` indexes.
   *
   * A file whose very first container does not parse counts 0 rather than
   * reporting -1.
   *
   * Only used by the tests.
   */
  async containerCount(): Promise<number> {
    let parsed = 0
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _container of this.iterContainers()) {
        parsed += 1
      }
    } catch {
      // the failed read past the last container is how the walk terminates;
      // every container counted before it parsed cleanly
    }
    return Math.max(parsed - 1, 0)
  }

  getContainerAtPosition(position: number) {
    return new CramContainer(this, position)
  }

  async _uncompress(
    compressionMethod: CompressionMethod,
    inputBuffer: Uint8Array,
    uncompressedSize: number,
  ): Promise<Uint8Array> {
    let buf: Uint8Array
    if (compressionMethod === 'gzip') {
      buf = await unzip(inputBuffer, uncompressedSize)
    } else if (compressionMethod === 'bzip2') {
      buf = await htscodecs.bz2_uncompress(inputBuffer, uncompressedSize)
    } else if (compressionMethod === 'lzma') {
      buf = await xzDecompress(inputBuffer)
    } else if (compressionMethod === 'rans') {
      buf = await htscodecs.rans_uncompress(inputBuffer)
    } else if (compressionMethod === 'rans4x16') {
      buf = await htscodecs.r4x16_uncompress(inputBuffer)
    } else if (compressionMethod === 'arith') {
      buf = await htscodecs.arith_uncompress(inputBuffer)
    } else if (compressionMethod === 'fqzcomp') {
      buf = await htscodecs.fqzcomp_uncompress(inputBuffer)
    } else if (compressionMethod === 'tok3') {
      buf = await htscodecs.tok3_uncompress(inputBuffer)
    } else {
      throw new CramUnimplementedError(
        `${compressionMethod} decompression not yet implemented`,
      )
    }
    if (buf.length !== uncompressedSize) {
      throw new CramMalformedError(
        `${compressionMethod} decompression produced ${buf.length} bytes, expected ${uncompressedSize}`,
      )
    }
    return buf
  }

  async readBlock(position: number, opts?: ReadOpts) {
    const { majorVersion } = await this.getDefinition()
    const { cramBlockHeader, cramBlockCrc32 } = await this._getSectionParsers()

    const headerBuf = await this.read(cramBlockHeader.maxLength, position, opts)
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
    const fullBuffer = await this.read(totalSize, position, opts)

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
    // Per CRAM spec (PR #681), blocks with uncompressed size 0 are treated as
    // empty regardless of the method byte — htsjdk has produced invalid empty
    // RANS blocks that would otherwise fail to decompress.
    const uncompressedData =
      blockHeader.uncompressedSize === 0
        ? new Uint8Array(0)
        : blockHeader.compressionMethod !== 'raw'
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
