const { Parser } = require('./binary-parser')

const cramFileDefinition = {
  parser: new Parser()
    .string('magic', { length: 4 })
    .uint8('majorVersion')
    .uint8('minorVersion')
    .string('fileId', { length: 20, stripNull: true }),
  maxLength: 26,
}

const cramContainerHeader1 = {
  parser: new Parser()
    .uint32('length') // byte size of the container data (blocks)
    .itf8('seqId') // reference sequence identifier, -1 for unmapped reads, -2 for multiple reference sequences
    .itf8('start') // the alignment start position or 0 for unmapped reads
    .itf8('alignmentSpan') // the length of the alignment or 0 for unmapped reads
    .itf8('numRecords') // number of records in the container
    .ltf8('recordCounter') // 1-based sequential index of records in the file/stream.
    .ltf8('numBases') // number of read bases
    .itf8('numBlocks') // the number of blocks
    .itf8('numLandmarks'), // the number of landmarks
  maxLength: 4 + 5 * 4 + 9 * 2 + 5 + 5,
}

const cramContainerHeader2 = {
  parser: new Parser()
    .itf8('numLandmarks') // the number of blocks
    // Each integer value of this array is a byte offset
    // into the blocks byte array. Landmarks are used for
    // random access indexing.
    .array('landmarks', {
      type: new Parser().itf8(),
      length: 'numLandmarks',
    })
    .uint32('crc32'),
  maxLength: numBlocks => 5 + numBlocks * 5 + 4,
}

const cramBlockHeader = {
  parser: new Parser()
    .uint8('method', {
      formatter: b => {
        const method = ['raw', 'gzip', 'bzip2', 'lzma', 'rans'][b]
        if (!method) throw new Error(`invalid compression method number ${b}`)
        return method
      },
    })
    .uint8('contentType', {
      formatter: b => {
        const method = [
          'FILE_HEADER',
          'COMPRESSION_HEADER',
          'MAPPED_SLICE_HEADER',
          'reserved',
          'EXTERNAL_DATA',
          'CORE_DATA',
        ][b]
        if (!method) throw new Error(`invalid block content type id ${b}`)
        return method
      },
    })
    .itf8('contentId')
    .itf8('compressedSize')
    .itf8('uncompressedSize'),
  maxLength: 17,
}

const ENCODING_NAMES = [
  'NULL', // 0
  'EXTERNAL', // 1
  'GOLOMB', // 2
  'HUFFMAN_INT', // 3
  'BYTE_ARRAY_LEN', // 4
  'BYTE_ARRAY_STOP', // 5
  'BETA', // 6
  'SUBEXP', // 7
  'GOLOMB_RICE', // 8
  'GAMMA', // 9
]

const cramEncoding = {
  parser: new Parser()
    .namely('cramEncoding')
    .itf8('codecId')
    .itf8('size')
    .choice('parameters', {
      tag: 'codecId',
      choices: {
        0: new Parser(), // NULL
        1: new Parser().itf8('blockContentId'), // EXTERNAL
        2: new Parser().itf8('offset').itf8('M'), // GOLOMB,
        3: Parser.start().buffer('data', { length: '$parent.size' }), // TODO // HUFFMAN_INT
        4: Parser.start() // BYTE_ARRAY_LEN
          .nest('lengthsEncoding', { type: 'cramEncoding' })
          .nest('valuesEncoding', { type: 'cramEncoding' }),
        5: new Parser().uint8('stopByte').itf8('blockContentId'), // BYTE_ARRAY_STOP
        6: new Parser().itf8('offset').itf8('length'), // BETA
        7: new Parser().itf8('offset').itf8('K'),
        8: new Parser().itf8('offset').itf8('log2m'), // GOLOMB_RICE
        9: new Parser().itf8('offset'), // GAMMA
      },
    }),
  maxLength: undefined,
}

const newMap = () => new Parser().itf8('mapSize') // note that the mapSize includes the bytes of the mapCount
// .itf8('mapCount')
const cramPreservationMap = newMap().buffer('data', {
  length: 'mapSize',
  // type: new Parser().string('key', { length: 2 }),
  // TODO: parse preservation map
})

const cramDataSeriesEncodingMap = newMap()
  .itf8('mapCount')
  .array('entries', {
    length: 'mapCount',
    type: new Parser()
      .string('key', { length: 2, stripNull: false })
      .nest('value', { type: cramEncoding.parser }),
  })

const cramTagEncodingMap = newMap().buffer('data', {
  length: 'mapSize',
  // type: new Parser().string('key', { length: 2 }),
  // TODO: parse tag encodings map
})

const cramCompressionHeader = {
  parser: new Parser()
    .nest('preservation', {
      type: cramPreservationMap,
    })
    .nest('dataSeriesEncoding', {
      type: cramDataSeriesEncodingMap,
    })
    .nest('tagEncoding', {
      type: cramTagEncodingMap,
    }),
}

module.exports = {
  cramFileDefinition,
  cramContainerHeader1,
  cramContainerHeader2,
  cramBlockHeader,
  cramCompressionHeader,
  cramEncoding,
}
