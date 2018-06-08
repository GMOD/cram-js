const CramCodec = require('./_base')

class BetaCodec extends CramCodec {
  constructor(parameters = {}, dataType) {
    super(parameters, dataType)
    if (this.dataType !== 'int') {
      throw new Error(
        `${this.dataType} decoding not yet implemented by BETA codec`,
      )
    }
  }

  decode(slice, coreDataBlock, blocksByContentId, cursors, numItems = 1) {
    if (numItems !== 1)
      throw new Error('only 1 decoded item supported right now')

    const data =
      this._getBits(
        coreDataBlock.content,
        cursors.coreBlock,
        this.parameters.length,
      ) - this.parameters.offset
    return data
  }
}

module.exports = BetaCodec
