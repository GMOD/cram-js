import BufferReader from './bufferReader.ts'
import { decodeUtf8, readNullTerminatedStringFromBuffer } from './util.ts'

import type { TupleOf } from '../typescript.ts'
import type { DataSeriesEncodingMap } from './codecs/dataSeriesTypes.ts'
import type { CramEncoding } from './encoding.ts'

const COMPRESSION_METHODS = [
  'raw',
  'gzip',
  'bzip2',
  'lzma',
  'rans',
  'rans4x16',
  'arith',
  'fqzcomp',
  'tok3',
] as const

const CONTENT_TYPES = [
  'FILE_HEADER',
  'COMPRESSION_HEADER',
  'MAPPED_SLICE_HEADER',
  'UNMAPPED_SLICE_HEADER', // < only used in cram v1
  'EXTERNAL_DATA',
  'CORE_DATA',
] as const

// Per-version dispatch for the optional `recordCounter` field shared by slice
// headers and container header 1. CRAM v3 uses LTF8, v2 uses ITF8, v1 omits it.
function readRecordCounter(r: BufferReader, majorVersion: number) {
  if (majorVersion >= 3) {
    return r.ltf8()
  } else if (majorVersion === 2) {
    return r.itf8()
  } else {
    console.warn('recordCounter=0')
    return 0
  }
}

export function cramFileDefinition() {
  return {
    parser: (b: Uint8Array, startOffset = 0) => {
      const r = new BufferReader(b, startOffset)
      const magic = decodeUtf8(r.bytes(4))
      const majorVersion = r.u8()
      const minorVersion = r.u8()
      // 20-byte null-padded field
      const fileId = readNullTerminatedStringFromBuffer(r.bytes(20))
      return {
        value: {
          magic,
          majorVersion,
          minorVersion,
          fileId,
        },
        offset: r.bytePosition,
      }
    },
    maxLength: 26,
  }
}

export function cramBlockHeader() {
  const parser = (buffer: Uint8Array, startOffset = 0) => {
    const r = new BufferReader(buffer, startOffset)

    const d = r.u8()
    const compressionMethod = COMPRESSION_METHODS[d]
    if (!compressionMethod) {
      throw new Error(`compression method number ${d} not implemented`)
    }

    const c = r.u8()
    const contentType = CONTENT_TYPES[c]
    if (!contentType) {
      throw new Error(`invalid block content type id ${c}`)
    }

    const contentId = r.itf8()
    const compressedSize = r.itf8()
    const uncompressedSize = r.itf8()
    return {
      offset: r.bytePosition,
      value: {
        uncompressedSize,
        compressedSize,
        contentId,
        contentType,
        compressionMethod,
      },
    }
  }
  return { parser, maxLength: 17 }
}

export function cramBlockCrc32() {
  return {
    parser: (buffer: Uint8Array, offset: number) => {
      const r = new BufferReader(buffer, offset)
      const crc32 = r.u32()
      return {
        offset: r.bytePosition,
        value: {
          crc32,
        },
      }
    },
    maxLength: 4,
  }
}

export type CramTagDictionary = string[][]

function makeTagSet(
  buffer: Uint8Array,
  stringStart: number,
  stringEnd: number,
) {
  const str = decodeUtf8(buffer.subarray(stringStart, stringEnd))
  const tags = []
  for (let i = 0; i < str.length; i += 3) {
    tags.push(str.slice(i, i + 3))
  }
  return tags
}

/** the TD preservation-map entry: null-separated runs of three-character tag ids */
function readTagDictionary(r: BufferReader) {
  const size = r.itf8()
  const subbuf = r.bytes(size)

  const tagSets = []
  let stringStart = 0
  let i = 0
  for (; i < subbuf.length; i++) {
    if (!subbuf[i]) {
      tagSets.push(makeTagSet(subbuf, stringStart, i))
      stringStart = i + 1
    }
  }
  if (i > stringStart) {
    tagSets.push(makeTagSet(subbuf, stringStart, i))
  }

  return { size, ents: tagSets }
}

export interface CramPreservationMap {
  MI?: boolean
  UI?: boolean
  PI?: boolean
  RN?: boolean
  AP?: boolean
  RR?: boolean
  SM: [number, number, number, number, number]
  TD: CramTagDictionary
}

function cramPreservationMap() {
  return {
    parser: (buffer: Uint8Array, offset: number) => {
      const r = new BufferReader(buffer, offset)
      const mapSize = r.itf8()
      const mapCount = r.itf8()
      const ents = []
      for (let i = 0; i < mapCount; i++) {
        const key = r.ascii(2)

        if (
          key === 'MI' ||
          key === 'UI' ||
          key === 'PI' ||
          key === 'RN' ||
          key === 'AP' ||
          key === 'RR'
        ) {
          ents.push({ key, value: r.bool() })
        } else if (key === 'SM') {
          ents.push({
            key,
            value: [r.u8(), r.u8(), r.u8(), r.u8(), r.u8()],
          })
        } else if (key === 'TD') {
          ents.push({ key, value: readTagDictionary(r).ents })
        } else {
          throw new Error(`unknown key ${key}`)
        }
      }
      return {
        value: {
          mapSize,
          mapCount,
          ents,
        },
        offset: r.bytePosition,
      }
    },
  }
}

function formatMap(data: { ents: { key: string; value: unknown }[] }) {
  const map: Record<string, unknown> = {}
  for (const { key, value } of data.ents) {
    if (map[key]) {
      console.warn(`duplicate key ${key} in map`)
    }
    map[key] = value
  }
  return map
}

export interface MappedSliceHeader {
  refSeqId: number
  /** 0-based; the file stores it 1-based and the parser shifts it */
  refSeqStart: number
  refSeqSpan: number
  numRecords: number
  recordCounter: number
  numBlocks: number
  numContentIds: number
  contentIds: number[]
  refBaseBlockId: number
  md5?: TupleOf<number, 16>
}

export interface UnmappedSliceHeader {
  numRecords: number
  recordCounter: number
  numBlocks: number
  numContentIds: number
  contentIds: number[]
  md5?: TupleOf<number, 16>
}

export function isMappedSliceHeader(
  header: unknown,
): header is MappedSliceHeader {
  return typeof (header as { refSeqId?: unknown }).refSeqId === 'number'
}

interface Value {
  codecId: number
  parametersBytes: number
  parameters: Record<string, unknown>
}

function readContentIds(r: BufferReader, numContentIds: number) {
  const contentIds = []
  for (let i = 0; i < numContentIds; i++) {
    contentIds.push(r.itf8())
  }
  return contentIds
}

/** the md5 of the slice's reference, absent in cram v1 */
function readMd5(r: BufferReader, majorVersion: number) {
  return majorVersion >= 2
    ? ([...r.bytes(16)] as TupleOf<number, 16>)
    : undefined
}

// assemble a section parser for the unmapped slice header, with slight
// variations depending on the major version of the cram file
function cramUnmappedSliceHeader(majorVersion: number) {
  let maxLength = 0
  maxLength += 5
  maxLength += 9
  maxLength += 5 * 2
  maxLength += 16

  const parser = (buffer: Uint8Array, offset: number) => {
    const r = new BufferReader(buffer, offset)
    const numRecords = r.itf8()
    const recordCounter = readRecordCounter(r, majorVersion)
    const numBlocks = r.itf8()
    const numContentIds = r.itf8()
    const contentIds = readContentIds(r, numContentIds)
    const md5 = readMd5(r, majorVersion)

    return {
      value: {
        recordCounter,
        md5,
        contentIds,
        numContentIds,
        numBlocks,
        numRecords,
      },
      offset: r.bytePosition,
    }
  }
  return {
    parser,
    maxLength: (numContentIds: number) => maxLength + numContentIds * 5,
  }
}

// assembles a section parser for the mapped slice header, with slight
// variations depending on the major version of the cram file
function cramMappedSliceHeader(majorVersion: number) {
  let maxLength = 0
  maxLength += 5 * 4 // EL0
  maxLength += 9 // EL1
  maxLength += 5 * 3 // EL2 ITF8s
  maxLength += 16 // MD5

  return {
    parser: (buffer: Uint8Array, offset: number) => {
      const r = new BufferReader(buffer, offset)
      const refSeqId = r.itf8()
      const refSeqStart = r.itf8()
      const refSeqSpan = r.itf8()
      const numRecords = r.itf8()
      const recordCounter = readRecordCounter(r, majorVersion)
      const numBlocks = r.itf8()
      const numContentIds = r.itf8()
      const contentIds = readContentIds(r, numContentIds)
      const refBaseBlockId = r.itf8()
      const md5 = readMd5(r, majorVersion)

      return {
        value: {
          md5,
          numBlocks,
          numRecords,
          numContentIds,
          refSeqSpan,
          refSeqId,
          // the file stores this 1-based; nothing downstream of this parse is.
          // Seeds cursors.lastAlignmentStart, so shifting it here is what makes
          // every record's AP-delta chain come out 0-based. On an unmapped or
          // multi-ref slice the stored value is a 0 placeholder rather than a
          // coordinate, and the -1 it becomes is still the right seed: the
          // chain is a pure sum, so a uniform shift of the seed shifts every
          // record start by exactly one.
          refSeqStart: refSeqStart - 1,
          recordCounter,
          refBaseBlockId,
          contentIds,
        },
        offset: r.bytePosition,
      }
    },
    maxLength: (numContentIds: number) => maxLength + numContentIds * 5,
  }
}

function cramEncodingSub(r: BufferReader): Value {
  const codecId = r.itf8()
  const parametersBytes = r.itf8()

  const parameters = {} as Record<string, unknown>

  if (codecId === 0) {
    // NULL
  } else if (codecId === 1) {
    // EXTERNAL
    parameters.blockContentId = r.itf8()
  } else if (codecId === 2) {
    // GOLUMB
    parameters.offset = r.itf8()
    parameters.M = r.itf8()
  } else if (codecId === 3) {
    // HUFFMAN_INT
    const numCodes = r.itf8()
    const symbols = [] as number[]
    for (let i = 0; i < numCodes; i++) {
      symbols.push(r.itf8())
    }
    const numLengths = r.itf8()
    const bitLengths = [] as number[]
    for (let i = 0; i < numLengths; i++) {
      bitLengths.push(r.itf8())
    }
    parameters.numCodes = numCodes
    parameters.symbols = symbols
    parameters.numLengths = numLengths
    parameters.bitLengths = bitLengths
  } else if (codecId === 4) {
    // BYTE_ARRAY_LEN
    parameters.lengthsEncoding = cramEncodingSub(r)
    parameters.valuesEncoding = cramEncodingSub(r)
  } else if (codecId === 5) {
    // BYTE_ARRAY_STOP
    parameters.stopByte = r.u8()
    parameters.blockContentId = r.itf8()
  } else if (codecId === 6) {
    // BETA
    parameters.offset = r.itf8()
    parameters.length = r.itf8()
  } else if (codecId === 7) {
    // SUBEXP
    parameters.offset = r.itf8()
    parameters.K = r.itf8()
  } else if (codecId === 8) {
    // GOLOMB_RICE
    parameters.offset = r.itf8()
    parameters.log2m = r.itf8()
  } else if (codecId === 9) {
    // GAMMA
    parameters.offset = r.itf8()
  } else {
    throw new Error(`unknown codecId ${codecId}`)
  }

  return {
    codecId,
    parametersBytes,
    parameters,
  }
}

function cramDataSeriesEncodingMap() {
  return {
    parser: (buffer: Uint8Array, offset: number) => {
      const r = new BufferReader(buffer, offset)
      const mapSize = r.itf8()
      const mapCount = r.itf8()
      const ents = []
      for (let i = 0; i < mapCount; i++) {
        const key = r.ascii(2)
        ents.push({ key, value: cramEncodingSub(r) })
      }
      return {
        value: {
          mapSize,
          ents,
          mapCount,
        },
        offset: r.bytePosition,
      }
    },
  }
}

function cramTagEncodingMap() {
  return {
    parser: (buffer: Uint8Array, offset: number) => {
      const r = new BufferReader(buffer, offset)
      const mapSize = r.itf8()
      const mapCount = r.itf8()
      const ents = []
      for (let i = 0; i < mapCount; i++) {
        // the three-character tag id is packed into one itf8
        const k0 = r.itf8()
        const key =
          String.fromCharCode((k0 >> 16) & 0xff) +
          String.fromCharCode((k0 >> 8) & 0xff) +
          String.fromCharCode(k0 & 0xff)

        ents.push({ key, value: cramEncodingSub(r) })
      }
      return {
        value: {
          mapSize,
          ents,
          mapCount,
        },
        offset: r.bytePosition,
      }
    },
  }
}

function cramCompressionHeader() {
  return {
    parser: (buffer: Uint8Array, offset: number) => {
      // TODO: if we want to support CRAM v1, we will need to refactor
      // compression header into 2 parts to parse the landmarks, like the
      // container header
      const { value: preservation, offset: newOffset1 } =
        cramPreservationMap().parser(buffer, offset)

      const { value: dataSeriesEncoding, offset: newOffset2 } =
        cramDataSeriesEncodingMap().parser(buffer, newOffset1)

      const { value: tagEncoding, offset: newOffset3 } =
        cramTagEncodingMap().parser(buffer, newOffset2)

      return {
        value: {
          dataSeriesEncoding: formatMap(
            dataSeriesEncoding,
          ) as DataSeriesEncodingMap,
          preservation: formatMap(
            preservation,
          ) as unknown as CramPreservationMap,
          tagEncoding: formatMap(tagEncoding) as Record<string, CramEncoding>,
        },
        offset: newOffset3,
      }
    },
  }
}

function cramContainerHeader1(majorVersion: number) {
  let maxLength = 4
  maxLength += 5 * 4
  maxLength += 9
  maxLength += 9
  maxLength += 5 + 5
  return {
    maxLength,
    parser: (buffer: Uint8Array, offset: number) => {
      const r = new BufferReader(buffer, offset)

      // byte size of the container data (blocks)
      const length = r.i32()

      // reference sequence identifier:
      // -1 for unmapped reads,
      // -2 for multiple reference sequences
      const refSeqId = r.itf8()
      const refSeqStart = r.itf8()
      const alignmentSpan = r.itf8()
      const numRecords = r.itf8()
      const recordCounter = readRecordCounter(r, majorVersion)
      const numBases = majorVersion > 1 ? r.ltf8() : undefined
      const numBlocks = r.itf8()
      const numLandmarks = r.itf8()
      return {
        value: {
          length,
          refSeqId,
          // 1-based in the file, 0-based from here on — see the slice header
          refSeqStart: refSeqStart - 1,
          alignmentSpan,
          numBlocks,
          numLandmarks,
          numBases,
          recordCounter,
          numRecords,
        },
        offset: r.bytePosition,
      }
    },
  }
}

function cramContainerHeader2(majorVersion: number) {
  return {
    parser: (buffer: Uint8Array, offset: number) => {
      const r = new BufferReader(buffer, offset)
      const numLandmarks = r.itf8()
      const landmarks = []
      for (let i = 0; i < numLandmarks; i++) {
        landmarks.push(r.itf8())
      }

      const crc32 = majorVersion >= 3 ? r.u32() : undefined
      return {
        value: {
          ...(crc32 === undefined ? {} : { crc32 }),
          numLandmarks,
          landmarks,
        },
        offset: r.bytePosition,
      }
    },
    maxLength: (numLandmarks: number) => 5 + 5 * numLandmarks + 4,
  }
}

export type CompressionMethod =
  | 'raw'
  | 'gzip'
  | 'bzip2'
  | 'lzma'
  | 'rans'
  | 'rans4x16'
  | 'arith'
  | 'fqzcomp'
  | 'tok3'

export interface BlockHeader {
  compressionMethod: CompressionMethod
  contentType:
    | 'FILE_HEADER'
    | 'COMPRESSION_HEADER'
    | 'MAPPED_SLICE_HEADER'
    | 'UNMAPPED_SLICE_HEADER' // < only used in cram v1
    | 'EXTERNAL_DATA'
    | 'CORE_DATA'
  contentId: number
  compressedSize: number
  uncompressedSize: number
}

export interface CramCompressionHeader {
  preservation: CramPreservationMap
  dataSeriesEncoding: DataSeriesEncodingMap
  tagEncoding: Record<string, CramEncoding>
  _size: number
  _endPosition: number
}

// The parsers are pure functions of (buffer, offset), so a set can be shared
// by every container and slice in a file. Without this each slice header read
// rebuilt all eleven parsers and their closures.
const sectionParserCache = new Map<
  number,
  ReturnType<typeof buildSectionParsers>
>()

export function getSectionParsers(majorVersion: number) {
  let parsers = sectionParserCache.get(majorVersion)
  if (parsers === undefined) {
    parsers = buildSectionParsers(majorVersion)
    sectionParserCache.set(majorVersion, parsers)
  }
  return parsers
}

function buildSectionParsers(majorVersion: number) {
  return {
    cramFileDefinition: cramFileDefinition(),
    cramBlockHeader: cramBlockHeader(),
    cramBlockCrc32: cramBlockCrc32(),
    cramDataSeriesEncodingMap: cramDataSeriesEncodingMap(),
    cramTagEncodingMap: cramTagEncodingMap(),
    cramCompressionHeader: cramCompressionHeader(),
    cramUnmappedSliceHeader: cramUnmappedSliceHeader(majorVersion),
    cramMappedSliceHeader: cramMappedSliceHeader(majorVersion),
    cramContainerHeader1: cramContainerHeader1(majorVersion),
    cramContainerHeader2: cramContainerHeader2(majorVersion),
  }
}
