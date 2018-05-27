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
  decode(slice, coreDataBlock, blocksByContentId, cursors, numItems = 1) {
    if (numItems !== 1) throw new Error('decoding multiple items not supported')

    const { blockContentId } = this.parameters
    const contentBlock = blocksByContentId[blockContentId]
    if (!contentBlock)
      throw new Error(`no block found with content ID ${blockContentId}`)
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

module.exports = ExternalCodec
