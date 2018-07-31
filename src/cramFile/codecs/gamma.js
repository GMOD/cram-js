const { CramUnimplementedError } = require('../../errors')
const CramCodec = require('./_base')

class GammaCodec extends CramCodec {
  constructor(parameters = {}, dataType) {
    super(parameters, dataType)
    if (this.dataType !== 'int') {
      throw new CramUnimplementedError(
        `${this.dataType} decoding not yet implemented by GAMMA codec`,
      )
    }
  }

  decode(slice, coreDataBlock, blocksByContentId, cursors) {
    let length = 1

    while (this._getBits(coreDataBlock.content, cursors.coreBlock, 1) === 0)
      length += 1

    const readBits = this._getBits(
      coreDataBlock.content,
      cursors.coreBlock,
      length - 1,
    )

    const value = readBits | (1 << (length - 1))
    return value - this.parameters.offset
  }
}

module.exports = GammaCodec
