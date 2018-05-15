const { Parser } = require('../binary-parser')

const singleItf8 = new Parser().itf8()

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
    .uint8('compressionMethod', {
      formatter: b => {
        const method = ['raw', 'gzip', 'bzip2', 'lzma', 'rans'][b]
        if (!method) throw new Error(`invalid compression method number ${b}`)
        return method
      },
    })
    .uint8('contentType', {
      formatter: b => {
        const type = [
          'FILE_HEADER',
          'COMPRESSION_HEADER',
          'MAPPED_SLICE_HEADER',
          'UNMAPPED_SLICE_HEADER', // < only used in cram v1
          'EXTERNAL_DATA',
          'CORE_DATA',
        ][b]
        if (!type) throw new Error(`invalid block content type id ${b}`)
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
        // HUFFMAN_INT
        3: Parser.start()
          .itf8('numCodes')
          .array('symbols', { length: 'numCodes', type: singleItf8 })
          .itf8('numLengths')
          .array('bitLengths', { length: 'numLengths', type: singleItf8 }),
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

const cramTagDictionary = new Parser().itf8('size').buffer('entries', {
  length: 'size',
  formatter: buffer => {
    /* eslint-disable */
    var strings = []
    var stringStart = 0
    var i
    /* eslint-enable */
    for (i = 0; i < buffer.length; i += 1) {
      if (!buffer[i]) {
        strings.push(buffer.toString('ascii', stringStart, i))
        stringStart = i + 1
      }
    }
    if (i > stringStart) strings.push(buffer.toString('ascii', stringStart, i))
    return strings
  },
})

// const cramPreservationMapKeys = 'XX RN AP RR SM TD'.split(' ')
const parseByteAsBool = new Parser().uint8(null, { formatter: val => !!val })

const cramPreservationMap = newMap()
  .itf8('mapCount')
  .array('entries', {
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
          TD: cramTagDictionary,
        },
      }),
  })

const cramDataSeriesEncodingMap = newMap()
  .itf8('mapCount')
  .array('entries', {
    length: 'mapCount',
    type: new Parser()
      .string('key', { length: 2, stripNull: false })
      .nest('value', { type: cramEncoding.parser }),
  })

const cramTagEncodingMap = newMap()
  .itf8('mapCount')
  .array('entries', {
    length: 'mapCount',
    type: new Parser()
      .itf8('key', {
        formatter: integerRepresentation =>
          String.fromCharCode((integerRepresentation >> 16) & 0xff) +
          String.fromCharCode((integerRepresentation >> 8) & 0xff) +
          String.fromCharCode(integerRepresentation & 0xff),
      })
      .nest('value', { type: cramEncoding.parser }),
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

const cramMappedSliceHeader = {
  parser: new Parser()
    .itf8('refSeqId')
    .itf8('refStart')
    .itf8('refSpan')
    .itf8('numRecords')
    .ltf8('recordCounter') // TODO: this is itf8 in a CRAM v2 file, absent in CRAM v1
    .itf8('numBlocks')
    .itf8('numContentIds')
    .array('contentIds', {
      type: singleItf8,
      length: 'numContentIds',
    })
    .itf8('refBaseID')
    .array('md5', { type: 'uint8', length: 16 }), // TODO: this is missing in CRAM v1

  maxLength: numContentIds => 5 * 3 + 9 + 5 * 2 + 5 * numContentIds + 9 + 16,
}

const cramUnmappedSliceHeader = {
  parser: new Parser()
    .itf8('numRecords')
    .ltf8('recordCounter') // TODO: this is itf8 in a CRAM v2 file, absent in CRAM v1
    .itf8('numBlocks')
    .itf8('numContentIds')
    .array('contentIds', {
      type: singleItf8,
      length: 'numContentIds',
    })
    .array('md5', { type: 'uint8', length: 16 }), // TODO: this is missing in CRAM v1

  maxLength: numContentIds => 5 + 9 + 5 * 2 + 5 * numContentIds + 16,
}

module.exports = {
  cramFileDefinition,
  cramContainerHeader1,
  cramContainerHeader2,
  cramBlockHeader,
  cramBlockCrc32,
  cramCompressionHeader,
  cramMappedSliceHeader,
  cramUnmappedSliceHeader,
}
