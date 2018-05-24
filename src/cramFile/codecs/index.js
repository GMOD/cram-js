const { parseItf8 } = require('../util')

/** codec base class */
class CramCodec {
  constructor(parameters = {}, dataType) {
    this.parameters = parameters
    this.dataType = dataType
    if (!dataType)
      throw new Error('must provide a data type to codec constructor')
  }

  // decode(slice, coreDataBlock, blocksByContentId, cursors) {
  // }
}

class ExternalCodec extends CramCodec {
  constructor(parameters = {}, dataType) {
    super(parameters, dataType)
    if (this.dataType === 'int') {
      this._decodeData = this._decodeInt
    } else {
      throw new Error(
        `${this.dataType} decoding not yet implemented by EXTERNAL codec`,
      )
    }
  }
  decode(slice, coreDataBlock, blocksByContentId, cursors) {
    const { blockContentId } = this.parameters
    const contentBlock = blocksByContentId[blockContentId]
    const cursor = cursors.externalBlocks.getCursor(blockContentId)
    return this._decodeData(contentBlock, cursor)
  }
  _decodeInt(contentBlock, cursor) {
    const [result, bytesRead] = parseItf8(
      contentBlock.content,
      cursor.bytePosition,
    )
    cursor.bytePosition += bytesRead
    return result
  }
}
class GolombCodec extends CramCodec {}
class HuffmanIntCodec extends CramCodec {}
class ByteArrayLengthCodec extends CramCodec {}
class ByteArrayStopCodec extends CramCodec {}
class BetaCodec extends CramCodec {}
class SubexpCodec extends CramCodec {}
class GolombRiceCodec extends CramCodec {}
class GammaCodec extends CramCodec {}

const codecClasses = {
  1: ExternalCodec,
  2: GolombCodec,
  3: HuffmanIntCodec,
  4: ByteArrayLengthCodec,
  5: ByteArrayStopCodec,
  6: BetaCodec,
  7: SubexpCodec,
  8: GolombRiceCodec,
  9: GammaCodec,
}

module.exports = {
  getCodecClassWithId(id) {
    return codecClasses[id]
  },
}
