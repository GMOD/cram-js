const CramCodec = require('./_base')

class HuffmanIntCodec extends CramCodec {
  constructor(parameters = {}, dataType) {
    super(parameters, dataType)
    if (!['byte', 'int'].includes(this.dataType)) {
      throw new Error(
        `${this.dataType} decoding not yet implemented by HUFFMAN_INT codec`,
      )
    }

    // parse the parameters together into a `codes` data structure
    this.codes = new Array(this.parameters.numCodes)
    for (let i = 0; i < this.parameters.numCodes; i += 1) {
      this.codes[i] = {
        symbol: this.parameters.symbols[i],
        bitLength: this.parameters.bitLengths[i],
      }
    }
    this._generateCanonicalCodes()

    // if this is a degenerate zero-length huffman code, special-case the decoding
    if (this.codes[0].bitLength === 0) this._decode = this._decodeZeroLengthCode
  }

  _generateCanonicalCodes() {
    let val = -1
    let lastLength = 0
    let maxVal = 0
    this.codes.forEach(codeRecord => {
      val += 1
      if (val > maxVal) throw new Error('assertion failed')

      if (codeRecord.bitLength > lastLength) {
        val <<= codeRecord.bitLength - lastLength
        lastLength = codeRecord.bitLength
        maxVal = (1 << codeRecord.bitLength) - 1
      }
      codeRecord.code = val
    })
  }

  decode(slice, coreDataBlock, blocksByContentId, cursors, numItems = 1) {
    const items = this._decode(
      slice,
      coreDataBlock,
      cursors.coreBlock,
      numItems,
    )
    if (numItems !== 1)
      throw new Error('only 1 decoded item supported right now')
    return items[0]
  }

  // _decodeNull() {
  //   return -1
  // }

  // the special case for zero-length codes
  _decodeZeroLengthCode(slice, coreDataBlock, coreCursor, numItems) {
    const { codes } = this
    const output = []

    for (let i = 0; i < numItems; i += 1) {
      output[i] = codes[0].symbol
    }
    return output
  }

  _decode(slice, coreDataBlock, coreCursor, numBytes) {
    // let /* int */ cram_huffman_decode_char(cram_slice *slice, cram_codec *c,
    //   cram_block *in, char *out, let /* int */ *out_size) {
    const { codes } = this
    const numCodes = codes.length
    const output = []
    const input = coreDataBlock.content

    for (let i = 0; i < numBytes; i += 1) {
      let /* int */ idx = 0
      let /* int */ length = 0
      let /* int */ lastLength = 0

      for (;;) {
        const /* int */ dlen = codes[idx].bitLength - lastLength

        length += dlen
        lastLength = length

        const val = this._getBits(input, coreCursor, dlen)

        idx = val - codes[idx].p
        if (idx >= numCodes || idx < 0)
          throw new Error('huffman decode assertion failed')

        if (codes[idx].code === val && codes[idx].bitLength === length) {
          output[i] = codes[idx].symbol
          break
        }
      }
    }

    return output
  }

  _getBits(data, cursor, numBits) {
    let val = 0
    for (let dlen = numBits; dlen; dlen -= 1) {
      // get the next `dlen` bits in the input, put them in val
      val <<= 1
      val |= (data[cursor.bytePosition] >> cursor.bitPosition) & 1
      cursor.bitPosition -= 1
      if (cursor.bitPosition < 0) cursor.bytePosition += 1
      cursor.bitPosition &= 7
    }
    return val
  }
}

module.exports = HuffmanIntCodec
