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
    .itf8('numBlocks'), // the number of blocks
  maxLength: 4 + 5 * 4 + 9 * 2 + 5,
}

const cramContainerHeader2 = {
  parser: new Parser()
    .itf8('numBlocks') // the number of blocks
    // Each integer value of this array is a byte offset
    // into the blocks byte array. Landmarks are used for
    // random access indexing.
    .array('landmarks', {
      type: new Parser().itf8(),
      length: 'numBlocks',
    })
    .uint32('crc32'),
  maxLength: numBlocks => 5 + numBlocks * 5 + 4,
}

module.exports = {
  cramFileDefinition,
  cramContainerHeader1,
  cramContainerHeader2,
}
