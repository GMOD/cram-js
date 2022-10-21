import { Parser } from '@gmod/binary-parser'
import { TupleOf } from '../typescript'
import { ParsedItem } from './util'
import { DataSeriesEncodingMap } from './codecs/dataSeriesTypes'
import { CramEncoding } from './encoding'

const singleItf8 = new Parser().itf8()

const cramFileDefinition = {
  parser: new Parser()
    .string('magic', { length: 4 })
    .uint8('majorVersion')
    .uint8('minorVersion')
    .string('fileId', { length: 20, stripNull: true }),
  maxLength: 26,
}

const cramBlockHeader = {
  parser: new Parser()
    .uint8('compressionMethod', {
      formatter: /* istanbul ignore next */ b => {
        const method = [
          'raw',
          'gzip',
          'bzip2',
          'lzma',
          'rans',
          'rans4x16',
          'arith',
          'fqzcomp',
          'tok3',
        ][b]
        if (!method) {
          throw new Error(`compression method number ${b} not implemented`)
        }
        return method
      },
    })
    .uint8('contentType', {
      formatter: /* istanbul ignore next */ b => {
        const type = [
          'FILE_HEADER',
          'COMPRESSION_HEADER',
          'MAPPED_SLICE_HEADER',
          'UNMAPPED_SLICE_HEADER', // < only used in cram v1
          'EXTERNAL_DATA',
          'CORE_DATA',
        ][b]
        if (!type) {
          throw new Error(`invalid block content type id ${b}`)
        }
        return type
      },
    })
    .itf8('contentId')
    .itf8('compressedSize')
    .itf8('uncompressedSize'),
  maxLength: 17,
}

const cramBlockCrc32 = {
  parser: new Parser().uint32('crc32'),
  maxLength: 4,
}

// const ENCODING_NAMES = [
//   'NULL', // 0
//   'EXTERNAL', // 1
//   'GOLOMB', // 2
//   'HUFFMAN_INT', // 3
//   'BYTE_ARRAY_LEN', // 4
//   'BYTE_ARRAY_STOP', // 5
//   'BETA', // 6
//   'SUBEXP', // 7
//   'GOLOMB_RICE', // 8
//   'GAMMA', // 9
// ]

export type CramTagDictionary = string[][]

const cramTagDictionary = new Parser().itf8('size').buffer('ents', {
  length: 'size',
  formatter: /* istanbul ignore next */ buffer => {
    function makeTagSet(stringStart: number, stringEnd: number) {
      const str = buffer.toString('utf8', stringStart, stringEnd)
      const tags = []
      for (let i = 0; i < str.length; i += 3) {
        tags.push(str.substr(i, 3))
      }
      return tags
    }

    /* eslint-disable */
    var tagSets = []
    var stringStart = 0
    var i
    /* eslint-enable */
    for (i = 0; i < buffer.length; i += 1) {
      if (!buffer[i]) {
        tagSets.push(makeTagSet(stringStart, i))
        stringStart = i + 1
      }
    }
    if (i > stringStart) {
      tagSets.push(makeTagSet(stringStart, i))
    }
    return tagSets
  },
})

// const cramPreservationMapKeys = 'XX RN AP RR SM TD'.split(' ')
const parseByteAsBool = new Parser().uint8(null, {
  formatter: /* istanbul ignore next */ val => !!val,
})

export type CramPreservationMap = {
  MI: boolean
  UI: boolean
  PI: boolean
  RN: boolean
  AP: boolean
  RR: boolean
  SM: [number, number, number, number, number]
  TD: CramTagDictionary
}

const cramPreservationMap = new Parser()
  .itf8('mapSize')
  .itf8('mapCount')
  .array('ents', {
    length: 'mapCount',
    type: new Parser()
      .string('key', {
        length: 2,
        stripNull: false,
        // formatter: val => cramPreservationMapKeys[val] || 0,
      })
      .choice('value', {
        tag: 'key',
        choices: {
          MI: parseByteAsBool,
          UI: parseByteAsBool,
          PI: parseByteAsBool,
          RN: parseByteAsBool,
          AP: parseByteAsBool,
          RR: parseByteAsBool,
          SM: new Parser().array(null, { type: 'uint8', length: 5 }),
          TD: new Parser().nest(null, {
            type: cramTagDictionary,
            formatter: /* istanbul ignore next */ data => data.ents,
          }),
        },
      }),
  })

/* istanbul ignore next */
function formatMap<T>(data: { ents: { key: string; value: T }[] }) {
  const map: { [x: string]: T } = {}
  for (let i = 0; i < data.ents.length; i += 1) {
    const { key, value } = data.ents[i]
    if (map[key]) {
      console.warn(`duplicate key ${key} in map`)
    }
    map[key] = value
  }
  return map
}

const unversionedParsers = {
  cramFileDefinition,
  cramBlockHeader,
  cramBlockCrc32,
}

export type MappedSliceHeader = {
  refSeqId: number
  refSeqStart: number
  refSeqSpan: number
  numRecords: number
  recordCounter: number
  numBlocks: number
  numContentIds: number
  contentIds: number[]
  refBaseBlockId: number
  md5: TupleOf<number, 16>
}

export type UnmappedSliceHeader = {
  numRecords: number
  recordCounter: number
  numBlocks: number
  numContentIds: number
  contentIds: number[]
  md5: TupleOf<number, 16>
}

export function isMappedSliceHeader(
  header: MappedSliceHeader | UnmappedSliceHeader,
): header is MappedSliceHeader {
  return typeof (header as any).refSeqId === 'number'
}

// each of these is a function of the major and minor version
const versionedParsers = {
  // assemble a section parser for the unmapped slice header, with slight
  // variations depending on the major version of the cram file
  cramUnmappedSliceHeader(majorVersion: number) {
    let maxLength = 0
    let parser = new Parser().itf8('numRecords')
    maxLength += 5

    // recordCounter is itf8 in a CRAM v2 file, absent in CRAM v1
    if (majorVersion >= 3) {
      parser = parser.ltf8('recordCounter')
      maxLength += 9
    } else if (majorVersion === 2) {
      parser = parser.itf8('recordCounter')
      maxLength += 5
    }

    parser = parser
      .itf8('numBlocks')
      .itf8('numContentIds')
      .array('contentIds', {
        type: singleItf8,
        length: 'numContentIds',
      })
    maxLength += 5 * 2 // + numContentIds*5

    // the md5 sum is missing in cram v1
    if (majorVersion >= 2) {
      parser = parser.array('md5', { type: 'uint8', length: 16 })
      maxLength += 16
    }

    const maxLengthFunc = (numContentIds: number) =>
      maxLength + numContentIds * 5

    return { parser, maxLength: maxLengthFunc } // : p, maxLength: numContentIds => 5 + 9 + 5 * 2 + 5 * numContentIds + 16 }
  },

  // assembles a section parser for the unmapped slice header, with slight
  // variations depending on the major version of the cram file
  cramMappedSliceHeader(majorVersion: number) {
    let parser = new Parser()
      .itf8('refSeqId')
      .itf8('refSeqStart')
      .itf8('refSeqSpan')
      .itf8('numRecords')
    let maxLength = 5 * 4

    if (majorVersion >= 3) {
      parser = parser.ltf8('recordCounter')
      maxLength += 9
    } else if (majorVersion === 2) {
      parser = parser.itf8('recordCounter')
      maxLength += 5
    }

    parser = parser
      .itf8('numBlocks')
      .itf8('numContentIds')
      .array('contentIds', {
        type: singleItf8,
        length: 'numContentIds',
      })
      .itf8('refBaseBlockId')
    maxLength += 5 * 3

    // the md5 sum is missing in cram v1
    if (majorVersion >= 2) {
      parser = parser.array('md5', { type: 'uint8', length: 16 })
      maxLength += 16
    }

    const maxLengthFunc = (numContentIds: number) =>
      maxLength + numContentIds * 5

    return { parser, maxLength: maxLengthFunc }
  },

  cramEncoding(majorVersion: number) {
    const parser = new Parser()
      .namely('cramEncoding')
      .itf8('codecId')
      .itf8('parametersBytes')
      .choice('parameters', {
        tag: 'codecId',
        choices: {
          0: new Parser(), // NULL
          1: new Parser().itf8('blockContentId'), // EXTERNAL
          2: new Parser().itf8('offset').itf8('M'), // GOLOMB,
          // HUFFMAN_INT
          3: Parser.start()
            .itf8('numCodes')
            .array('symbols', { length: 'numCodes', type: singleItf8 })
            .itf8('numLengths')
            .array('bitLengths', { length: 'numLengths', type: singleItf8 }),
          4: Parser.start() // BYTE_ARRAY_LEN
            .nest('lengthsEncoding', { type: 'cramEncoding' })
            .nest('valuesEncoding', { type: 'cramEncoding' }),
          // BYTE_ARRAY_STOP is a little different for CRAM v1
          5: new Parser().uint8('stopByte').itf8('blockContentId'),
          6: new Parser().itf8('offset').itf8('length'), // BETA
          7: new Parser().itf8('offset').itf8('K'), // SUBEXP
          8: new Parser().itf8('offset').itf8('log2m'), // GOLOMB_RICE
          9: new Parser().itf8('offset'), // GAMMA
        },
      })

    return { parser }
  },

  cramDataSeriesEncodingMap(majorVersion: number) {
    return new Parser()
      .itf8('mapSize')
      .itf8('mapCount')
      .array('ents', {
        length: 'mapCount',
        type: new Parser()
          .string('key', { length: 2, stripNull: false })
          .nest('value', { type: this.cramEncoding(majorVersion).parser }),
      })
  },

  cramTagEncodingMap(majorVersion: number) {
    return new Parser()
      .itf8('mapSize')
      .itf8('mapCount')
      .array('ents', {
        length: 'mapCount',
        type: new Parser()
          .itf8('key', {
            formatter: /* istanbul ignore next */ integerRepresentation =>
              /* istanbul ignore next */
              String.fromCharCode((integerRepresentation >> 16) & 0xff) +
              String.fromCharCode((integerRepresentation >> 8) & 0xff) +
              String.fromCharCode(integerRepresentation & 0xff),
          })
          .nest('value', { type: this.cramEncoding(majorVersion).parser }),
      })
  },

  cramCompressionHeader(majorVersion: number) {
    let parser = new Parser()
    // TODO: if we want to support CRAM v1, we will need to refactor
    // compression header into 2 parts to parse the landmarks,
    // like the container header
    parser = parser
      .nest('preservation', {
        type: cramPreservationMap,
        formatter: formatMap,
      })
      .nest('dataSeriesEncoding', {
        type: this.cramDataSeriesEncodingMap(majorVersion),
        formatter: formatMap,
      })
      .nest('tagEncoding', {
        type: this.cramTagEncodingMap(majorVersion),
        formatter: formatMap,
      })
    return { parser }
  },

  cramContainerHeader1(majorVersion: number) {
    let parser = new Parser()
      .int32('length') // byte size of the container data (blocks)
      .itf8('refSeqId') // reference sequence identifier, -1 for unmapped reads, -2 for multiple reference sequences
      .itf8('refSeqStart') // the alignment start position or 0 for unmapped reads
      .itf8('alignmentSpan') // the length of the alignment or 0 for unmapped reads
      .itf8('numRecords') // number of records in the container
    let maxLength = 4 + 5 * 4

    if (majorVersion >= 3) {
      parser = parser.ltf8('recordCounter') // 1-based sequential index of records in the file/stream.
      maxLength += 9
    } else if (majorVersion === 2) {
      parser = parser.itf8('recordCounter')
      maxLength += 5
    }

    if (majorVersion > 1) {
      parser = parser.ltf8('numBases') // number of read bases
      maxLength += 9
    }
    parser = parser
      .itf8('numBlocks') // the number of blocks
      .itf8('numLandmarks') // the number of landmarks
    maxLength += 5 + 5

    return { parser, maxLength }
  },

  cramContainerHeader2(majorVersion: number) {
    let parser = new Parser()
      .itf8('numLandmarks') // the number of blocks
      // Each integer value of this array is a byte offset
      // into the blocks byte array. Landmarks are used for
      // random access indexing.
      .array('landmarks', {
        type: new Parser().itf8(),
        length: 'numLandmarks',
      })

    let crcLength = 0
    if (majorVersion >= 3) {
      parser = parser.uint32('crc32')
      crcLength = 4
    }
    return {
      parser,
      maxLength: (numLandmarks: number) => 5 + numLandmarks * 5 + crcLength,
    }
  },
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

export type BlockHeader = {
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

export type CramCompressionHeader = ParsedItem<{
  preservation: CramPreservationMap
  dataSeriesEncoding: DataSeriesEncodingMap
  tagEncoding: Record<string, CramEncoding>
}>

function getSectionParsers(majorVersion: number): {
  cramFileDefinition: {
    parser: Parser<{
      magic: string
      majorVersion: number
      minorVersion: number
      fileId: string
    }>
    maxLength: number
  }
  cramContainerHeader1: {
    parser: Parser<{
      length: number
      refSeqId: number
      refSeqStart: number
      alignmentSpan: number
      numRecords: number
      recordCounter: number
      numBases: number
      numBlocks: number
      numLandmarks: number
    }>
    maxLength: number
  }
  cramContainerHeader2: {
    parser: Parser<{
      numLandmarks: number
      landmarks: number[]
      crc32: number
    }>
    maxLength: (x: number) => number
  }
  cramBlockHeader: {
    parser: Parser<BlockHeader>
    maxLength: number
  }
  cramBlockCrc32: {
    parser: Parser<{ crc32: number }>
    maxLength: number
  }
  cramCompressionHeader: {
    parser: Parser<CramCompressionHeader>
  }
  cramMappedSliceHeader: {
    parser: Parser<MappedSliceHeader>
    maxLength: (numContentIds: number) => number
  }
  cramUnmappedSliceHeader: {
    parser: Parser<UnmappedSliceHeader>
    maxLength: (numContentIds: number) => number
  }
} {
  const parsers: any = Object.assign({}, unversionedParsers)
  Object.keys(versionedParsers).forEach(parserName => {
    parsers[parserName] = (versionedParsers as any)[parserName](majorVersion)
  })
  return parsers
}

export { cramFileDefinition, getSectionParsers }
