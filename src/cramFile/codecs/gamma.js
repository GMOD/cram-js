import { CramUnimplementedError } from '../../errors'
import CramCodec from './_base'
import { getBits } from './getBits'

export default class GammaCodec extends CramCodec {
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

    while (getBits(coreDataBlock.content, cursors.coreBlock, 1) === 0) {
      length += 1
    }

    const readBits = getBits(
      coreDataBlock.content,
      cursors.coreBlock,
      length - 1,
    )

    const value = readBits | (1 << (length - 1))
    return value - this.parameters.offset
  }
}
