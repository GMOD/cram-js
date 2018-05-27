const CramCodec = require('./_base')
const { parseItf8 } = require('../util')

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
    // TODO: how do we manage the out_sz and out_size params
    // return data, and number of bytes read
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

module.exports = ExternalCodec
