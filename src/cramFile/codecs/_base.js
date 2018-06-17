const { CramBufferOverrunError } = require('../../errors')

const validDataTypes = {
  int: true,
  byte: true,
  long: true,
  byteArray: true,
  byteArrayBlock: true,
}

/** codec base class */
class CramCodec {
  constructor(parameters = {}, dataType) {
    this.parameters = parameters
    this.dataType = dataType
    if (!dataType)
      throw new TypeError('must provide a data type to codec constructor')
    if (!validDataTypes[dataType])
      throw new TypeError(`invalid data type ${dataType}`)
  }

  // decode(slice, coreDataBlock, blocksByContentId, cursors) {
  // }

  _getBits(data, cursor, numBits) {
    let val = 0
    if (
      cursor.bytePosition + (7 - cursor.bitPosition + numBits) / 8 >
      data.length
    )
      throw new CramBufferOverrunError(
        'read error during decoding. the file seems to be truncated.',
      )
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

module.exports = CramCodec
