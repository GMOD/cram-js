import { TupleOf } from '../typescript'
import { parseItf8, parseLtf8 } from './util'
import { DataSeriesEncodingMap } from './codecs/dataSeriesTypes'
import { CramEncoding } from './encoding'

export function cramFileDefinition() {
  return {
    parser: (buffer: Buffer, _startOffset = 0) => {
      const b = buffer
      const dataView = new DataView(b.buffer, b.byteOffset, b.length)
      let offset = 0
      const magic = buffer.subarray(offset, offset + 4).toString()
      offset += 4
      const majorVersion = dataView.getUint8(offset)
      offset += 1
      const minorVersion = dataView.getUint8(offset)
      offset += 1
      const fileId = b
        .subarray(offset, offset + 20)
        .toString()
        .replaceAll('\0', '')
      offset += 20
      return {
        value: {
          magic,
          majorVersion,
          minorVersion,
          fileId,
        },
        offset,
      }
    },
    maxLength: 26,
  }
}
export function cramBlockHeader() {
  const parser = (buffer: Buffer, _startOffset = 0) => {
    const b = buffer
    const dataView = new DataView(b.buffer, b.byteOffset, b.length)
    let offset = 0
    const d = dataView.getUint8(offset)
    const compressionMethod = [
      'raw',
      'gzip',
      'bzip2',
      'lzma',
      'rans',
      'rans4x16',
      'arith',
      'fqzcomp',
      'tok3',
    ][d]
    if (!compressionMethod) {
      throw new Error(`compression method number ${d} not implemented`)
    }
    offset += 1

    const c = dataView.getUint8(offset)
    const contentType = [
      'FILE_HEADER',
      'COMPRESSION_HEADER',
      'MAPPED_SLICE_HEADER',
      'UNMAPPED_SLICE_HEADER', // < only used in cram v1
      'EXTERNAL_DATA',
      'CORE_DATA',
    ][c]
    if (!contentType) {
      throw new Error(`invalid block content type id ${c}`)
    }
    offset += 1

    const [contentId, newOffset1] = parseItf8(buffer, offset)
    offset += newOffset1
    const [compressedSize, newOffset2] = parseItf8(buffer, offset)
    offset += newOffset2
    const [uncompressedSize, newOffset3] = parseItf8(buffer, offset)
    offset += newOffset3
    return {
      offset,
      value: {
        uncompressedSize,
        compressedSize,
        contentId,
        contentType: contentType as
          | 'FILE_HEADER'
          | 'COMPRESSION_HEADER'
          | 'MAPPED_SLICE_HEADER'
          | 'UNMAPPED_SLICE_HEADER' // < only used in cram v1
          | 'EXTERNAL_DATA'
          | 'CORE_DATA',
        compressionMethod: compressionMethod as CompressionMethod,
      },
    }
  }
  return { parser, maxLength: 17 }
}

export function cramBlockCrc32() {
  return {
    parser: (buffer: Buffer, offset: number) => {
      const b = buffer
      const dataView = new DataView(b.buffer, b.byteOffset, b.length)
      const crc32 = dataView.getUint32(offset, true)
      offset += 4
      return {
        offset,
        value: {
          crc32,
        },
      }
    },
    maxLength: 4,
  }
}

export type CramTagDictionary = string[][]

function makeTagSet(buffer: Buffer, stringStart: number, stringEnd: number) {
  const str = buffer.toString('utf8', stringStart, stringEnd)
  const tags = []
  for (let i = 0; i < str.length; i += 3) {
    tags.push(str.slice(i, i + 3))
  }
  return tags
}

export function cramTagDictionary() {
  return {
    parser: (buffer: Buffer, offset: number) => {
      const [size, newOffset1] = parseItf8(buffer, offset)
      offset += newOffset1
      const subbuf = buffer.subarray(offset, offset + size)
      offset += size

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

      return {
        value: {
          size,
          ents: tagSets,
        },
        offset,
      }
    },
  }
}

export interface CramPreservationMap {
  MI: boolean
  UI: boolean
  PI: boolean
  RN: boolean
  AP: boolean
  RR: boolean
  SM: [number, number, number, number, number]
  TD: CramTagDictionary
}

export function cramPreservationMap() {
  return {
    parser: (buffer: Buffer, offset: number) => {
      const b = buffer
      const dataView = new DataView(b.buffer, b.byteOffset, b.length)
      const [mapSize, newOffset1] = parseItf8(buffer, offset)
      offset += newOffset1
      const [mapCount, newOffset2] = parseItf8(buffer, offset)
      offset += newOffset2
      const ents = []
      for (let i = 0; i < mapCount; i++) {
        const key =
          String.fromCharCode(buffer[offset]) +
          String.fromCharCode(buffer[offset + 1])
        offset += 2

        if (
          key === 'MI' ||
          key === 'UI' ||
          key === 'PI' ||
          key === 'RN' ||
          key === 'AP' ||
          key === 'RR'
        ) {
          ents.push({
            key,
            value: !!dataView.getUint8(offset),
          })
          offset += 1
        } else if (key === 'SM') {
          ents.push({
            key,
            value: [
              dataView.getUint8(offset),
              dataView.getUint8(offset + 1),
              dataView.getUint8(offset + 2),
              dataView.getUint8(offset + 3),
              dataView.getUint8(offset + 4),
            ],
          })
          offset += 5
        } else if (key === 'TD') {
          const { offset: offsetRet, value } = cramTagDictionary().parser(
            buffer,
            offset,
          )
          ents.push({ key, value: value.ents })
          offset = offsetRet
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
        offset,
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
  return typeof (header as any).refSeqId === 'number'
}

interface Value {
  codecId: number
  parametersBytes: number
  parameters: Record<string, unknown>
}
// assemble a section parser for the unmapped slice header, with slight
// variations depending on the major version of the cram file
function cramUnmappedSliceHeader(majorVersion: number) {
  let maxLength = 0
  maxLength += 5
  maxLength += 9
  maxLength += 5 * 2
  maxLength += 16

  const parser = (buffer: Buffer, offset: number) => {
    const [numRecords, newOffset1] = parseItf8(buffer, offset)
    offset += newOffset1
    let recordCounter = 0

    // recordCounter is itf8 in a CRAM v2 file, absent in CRAM v1
    if (majorVersion >= 3) {
      const [rc, newOffset2] = parseLtf8(buffer, offset)
      offset += newOffset2
      recordCounter = rc
    } else if (majorVersion === 2) {
      const [rc, newOffset2] = parseItf8(buffer, offset)
      offset += newOffset2
      recordCounter = rc
    } else {
      console.warn('recordCounter=0')
    }

    const [numBlocks, newOffset3] = parseItf8(buffer, offset)
    offset += newOffset3
    const [numContentIds, newOffset4] = parseItf8(buffer, offset)
    offset += newOffset4
    const contentIds = []
    for (let i = 0; i < numContentIds; i++) {
      const [id, newOffset5] = parseItf8(buffer, offset)
      offset += newOffset5
      contentIds.push(id)
    }

    // the md5 sum is missing in cram v1
    let md5: TupleOf<number, 16> | undefined
    if (majorVersion >= 2) {
      md5 = [...buffer.subarray(offset, offset + 16)] as TupleOf<number, 16>
      offset += 16
    }

    return {
      value: {
        recordCounter,
        md5,
        contentIds,
        numContentIds,
        numBlocks,
        numRecords,
      },
      offset,
    }
  }
  return {
    parser,
    maxLength: (numContentIds: number) => maxLength + numContentIds * 5,
  }
}

// assembles a section parser for the unmapped slice header, with slight
// variations depending on the major version of the cram file
function cramMappedSliceHeader(majorVersion: number) {
  let maxLength = 0
  maxLength += 5 * 4 // EL0
  maxLength += 9 // EL1
  maxLength += 5 * 3 // EL2 ITF8s
  maxLength += 16 // MD5

  return {
    parser: (buffer: Buffer, offset: number) => {
      // L0
      const [refSeqId, newOffset1] = parseItf8(buffer, offset)
      offset += newOffset1
      const [refSeqStart, newOffset2] = parseItf8(buffer, offset)
      offset += newOffset2
      const [refSeqSpan, newOffset3] = parseItf8(buffer, offset)
      offset += newOffset3
      const [numRecords, newOffset4] = parseItf8(buffer, offset)
      offset += newOffset4
      // EL0

      // L1
      let recordCounter = 0
      if (majorVersion >= 3) {
        const [rc, newOffset5] = parseLtf8(buffer, offset)
        offset += newOffset5
        recordCounter = rc
      } else if (majorVersion === 2) {
        const [rc, newOffset5] = parseItf8(buffer, offset)
        offset += newOffset5
        recordCounter = rc
      } else {
        console.warn('majorVersion is <2, recordCounter set to 0')
      }
      // EL1

      // L2
      const [numBlocks, newOffset6] = parseItf8(buffer, offset)
      offset += newOffset6
      const [numContentIds, newOffset7] = parseItf8(buffer, offset)
      offset += newOffset7
      const contentIds = []
      for (let i = 0; i < numContentIds; i++) {
        const [id, newOffset5] = parseItf8(buffer, offset)
        offset += newOffset5
        contentIds.push(id)
      }
      const [refBaseBlockId, newOffset8] = parseItf8(buffer, offset)
      offset += newOffset8
      // EL2

      // the md5 sum is missing in cram v1
      let md5: TupleOf<number, 16> | undefined
      if (majorVersion >= 2) {
        md5 = [...buffer.subarray(offset, offset + 16)] as TupleOf<number, 16>
        offset += 16
      }

      return {
        value: {
          md5,
          numBlocks,
          numRecords,
          numContentIds,
          refSeqSpan,
          refSeqId,
          refSeqStart,
          recordCounter,
          refBaseBlockId,
          contentIds,
        },
        offset,
      }
    },
    maxLength: (numContentIds: number) => maxLength + numContentIds * 5,
  }
}

function cramEncoding() {
  return {
    parser: (buffer: Buffer, offset: number) => cramEncodingSub(buffer, offset),
  }
}

function cramEncodingSub(
  buffer: Buffer,
  offset: number,
): { value: Value; offset: number } {
  const b = buffer
  const dataView = new DataView(b.buffer, b.byteOffset, b.length)
  const [codecId, newOffset1] = parseItf8(buffer, offset)
  offset += newOffset1
  const [parametersBytes, newOffset2] = parseItf8(buffer, offset)
  offset += newOffset2

  const parameters = {} as Record<string, unknown>

  if (codecId === 0) {
    // NULL
  } else if (codecId === 1) {
    // EXTERNAL
    const [bc, newOffset3] = parseItf8(buffer, offset)
    parameters.blockContentId = bc
    offset += newOffset3
  } else if (codecId === 2) {
    // GOLUMB
    const [off, newOffset3] = parseItf8(buffer, offset)
    parameters.offset = off
    offset += newOffset3
    const [M2, newOffset4] = parseItf8(buffer, offset)
    parameters.M = M2
    offset += newOffset4
  } else if (codecId === 3) {
    // HUFFMAN_INT
    const val = parseItf8(buffer, offset)
    const numCodes = val[0]
    offset += val[1]
    const symbols = [] as number[]
    for (let i = 0; i < numCodes; i++) {
      const code = parseItf8(buffer, offset)
      symbols.push(code[0])
      offset += code[1]
    }
    parameters.symbols = symbols
    const val2 = parseItf8(buffer, offset)
    const numLengths = val[0]
    parameters.numLengths = numLengths
    parameters.numCodes = numCodes
    parameters.numLengths = numLengths
    offset += val2[1]
    const bitLengths = [] as number[]
    for (let i = 0; i < numLengths; i++) {
      const len = parseItf8(buffer, offset)
      offset += len[1]
      bitLengths.push(len[0])
    }
    parameters.bitLengths = bitLengths
  } else if (codecId === 4) {
    // BYTE_ARRAY_LEN
    const { value: lengthsEncoding, offset: newOffset1 } = cramEncodingSub(
      buffer,
      offset,
    )
    parameters.lengthsEncoding = lengthsEncoding
    offset = newOffset1
    const { value: valuesEncoding, offset: newOffset2 } = cramEncodingSub(
      buffer,
      offset,
    )
    parameters.valuesEncoding = valuesEncoding
    offset = newOffset2
  } else if (codecId === 5) {
    // BYTE_ARRAY_STOP
    parameters.stopByte = dataView.getUint8(offset)
    offset += 1
    const [blockContentId, newOffset1] = parseItf8(buffer, offset)
    parameters.blockContentId = blockContentId
    offset += newOffset1
  } else if (codecId === 6) {
    // BETA
    const [off, newOffset1] = parseItf8(buffer, offset)
    parameters.offset = off
    offset += newOffset1
    const [len, newOffset2] = parseItf8(buffer, offset)
    parameters.length = len
    offset += newOffset2
  } else if (codecId === 7) {
    // SUBEXP
    const [off, newOffset1] = parseItf8(buffer, offset)
    parameters.offset = off
    offset += newOffset1
    const [K, newOffset2] = parseItf8(buffer, offset)
    parameters.K = K
    offset += newOffset2
  } else if (codecId === 8) {
    // GOLOMB_RICE
    const [off, newOffset1] = parseItf8(buffer, offset)
    parameters.offset = off
    offset += newOffset1
    const [l2m, newOffset2] = parseItf8(buffer, offset)
    parameters.log2m = l2m
    offset += newOffset2
  } else if (codecId === 9) {
    // GAMMA
    const [off, newOffset1] = parseItf8(buffer, offset)
    parameters.offset = off
    offset += newOffset1
  } else {
    throw new Error(`unknown codecId ${codecId}`)
  }

  return {
    value: {
      codecId,
      parametersBytes,
      parameters,
    },
    offset,
  }
}

function cramDataSeriesEncodingMap() {
  return {
    parser: (buffer: Buffer, offset: number) => {
      const [mapSize, newOffset1] = parseItf8(buffer, offset)
      offset += newOffset1
      const [mapCount, newOffset2] = parseItf8(buffer, offset)
      offset += newOffset2
      const ents = []
      for (let i = 0; i < mapCount; i++) {
        const key =
          String.fromCharCode(buffer[offset]) +
          String.fromCharCode(buffer[offset + 1])
        offset += 2

        const { value, offset: newOffset4 } = cramEncodingSub(buffer, offset)
        offset = newOffset4
        ents.push({ key, value })
      }
      return {
        value: {
          mapSize,
          ents,
          mapCount,
        },
        offset,
      }
    },
  }
}

function cramTagEncodingMap() {
  return {
    parser: (buffer: Buffer, offset: number) => {
      const [mapSize, newOffset1] = parseItf8(buffer, offset)
      offset += newOffset1
      const [mapCount, newOffset2] = parseItf8(buffer, offset)
      offset += newOffset2
      const ents = []
      for (let i = 0; i < mapCount; i++) {
        const [k0, newOffset3] = parseItf8(buffer, offset)
        offset += newOffset3
        const key =
          String.fromCharCode((k0 >> 16) & 0xff) +
          String.fromCharCode((k0 >> 8) & 0xff) +
          String.fromCharCode(k0 & 0xff)

        const { value, offset: newOffset4 } = cramEncodingSub(buffer, offset)
        offset = newOffset4
        ents.push({ key, value })
      }
      return {
        value: {
          mapSize,
          ents,
          mapCount,
        },
        offset,
      }
    },
  }
}

function cramCompressionHeader() {
  return {
    parser: (buffer: Buffer, offset: number) => {
      // TODO: if we want to support CRAM v1, we will need to refactor
      // compression header into 2 parts to parse the landmarks, like the
      // container header
      const { value: preservation, offset: newOffset1 } =
        cramPreservationMap().parser(buffer, offset)
      offset = newOffset1

      const { value: dataSeriesEncoding, offset: newOffset2 } =
        cramDataSeriesEncodingMap().parser(buffer, offset)
      offset = newOffset2

      const { value: tagEncoding, offset: newOffset3 } =
        cramTagEncodingMap().parser(buffer, offset)
      offset = newOffset3

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
        offset,
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
    parser: (buffer: Buffer, offset: number) => {
      const b = buffer
      const dataView = new DataView(b.buffer, b.byteOffset, b.length)
      // byte size of the container data (blocks)
      const length = dataView.getInt32(offset, true)
      offset += 4
      // reference sequence identifier, -1 for unmapped reads, -2 for multiple
      // reference sequences
      const [refSeqId, newOffset1] = parseItf8(buffer, offset)
      offset += newOffset1
      const [refSeqStart, newOffset2] = parseItf8(buffer, offset)
      offset += newOffset2
      const [alignmentSpan, newOffset3] = parseItf8(buffer, offset)
      offset += newOffset3
      const [numRecords, newOffset4] = parseItf8(buffer, offset)
      offset += newOffset4

      let recordCounter = 0
      if (majorVersion >= 3) {
        const [rc, newOffset5] = parseLtf8(buffer, offset)
        recordCounter = rc
        offset += newOffset5
      } else if (majorVersion === 2) {
        const [rc, newOffset5] = parseItf8(buffer, offset)
        recordCounter = rc
        offset += newOffset5
      } else {
        console.warn('setting recordCounter=0')
      }

      let numBases: number | undefined
      if (majorVersion > 1) {
        const [n, newOffset5] = parseLtf8(buffer, offset)
        numBases = n
        offset += newOffset5
      }
      const [numBlocks, newOffset6] = parseItf8(buffer, offset)
      offset += newOffset6
      const [numLandmarks, newOffset7] = parseItf8(buffer, offset)
      offset += newOffset7
      return {
        value: {
          length,
          refSeqId,
          refSeqStart,
          alignmentSpan,
          numBlocks,
          numLandmarks,
          numBases,
          recordCounter,
          numRecords,
        },
        offset,
      }
    },
  }
}

function cramContainerHeader2(majorVersion: number) {
  return {
    parser: (buffer: Buffer, offset: number) => {
      const b = buffer
      const dataView = new DataView(b.buffer, b.byteOffset, b.length)
      const [numLandmarks, newOffset1] = parseItf8(buffer, offset)
      offset += newOffset1
      const landmarks = []
      for (let i = 0; i < numLandmarks; i++) {
        const [landmark, newOffset2] = parseItf8(buffer, offset)
        offset += newOffset2
        landmarks.push(landmark)
      }

      let crc32: number | undefined
      if (majorVersion >= 3) {
        crc32 = dataView.getUint32(offset, true)
        offset += 4
      }
      return {
        value: {
          ...(crc32 === undefined ? {} : { crc32 }),
          numLandmarks,
          landmarks,
        },
        offset,
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

export function getSectionParsers(majorVersion: number) {
  return {
    cramFileDefinition: cramFileDefinition(),
    cramBlockHeader: cramBlockHeader(),
    cramBlockCrc32: cramBlockCrc32(),
    cramDataSeriesEncodingMap: cramDataSeriesEncodingMap(),
    cramTagEncodingMap: cramTagEncodingMap(),
    cramCompressionHeader: cramCompressionHeader(),
    cramEncoding: cramEncoding(),
    cramUnmappedSliceHeader: cramUnmappedSliceHeader(majorVersion),
    cramMappedSliceHeader: cramMappedSliceHeader(majorVersion),
    cramContainerHeader1: cramContainerHeader1(majorVersion),
    cramContainerHeader2: cramContainerHeader2(majorVersion),
  }
}
