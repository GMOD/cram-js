import { CramUnimplementedError } from '../../errors'
import CramCodec from './_base'
import { getBits } from './getBits'

export default class BetaCodec extends CramCodec {
  constructor(parameters = {}, dataType) {
    super(parameters, dataType)
    if (this.dataType !== 'int') {
      throw new CramUnimplementedError(
        `${this.dataType} decoding not yet implemented by BETA codec`,
      )
    }
  }

  decode(slice, coreDataBlock, blocksByContentId, cursors) {
    const data =
      getBits(
        coreDataBlock.content,
        cursors.coreBlock,
        this.parameters.length,
      ) - this.parameters.offset
    return data
  }
}
