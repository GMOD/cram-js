import { CramUnimplementedError } from '../../errors'
import CramCodec from './_base'
import { getBits } from './getBits'

export default class SubexpCodec extends CramCodec {
  constructor(parameters = {}, dataType) {
    super(parameters, dataType)
    if (this.dataType !== 'int') {
      throw new CramUnimplementedError(
        `${this.dataType} decoding not yet implemented by SUBEXP codec`,
      )
    }
  }

  decode(slice, coreDataBlock, blocksByContentId, cursors) {
    let numLeadingOnes = 0
    while (getBits(coreDataBlock.content, cursors.coreBlock, 1)) {
      numLeadingOnes += 1
    }

    let b
    let n
    if (numLeadingOnes === 0) {
      b = this.parameters.K
      n = getBits(coreDataBlock.content, cursors.coreBlock, b)
    } else {
      b = numLeadingOnes + this.parameters.K - 1
      n = (1 << b) | getBits(coreDataBlock.content, cursors.coreBlock, b)
    }

    return n - this.parameters.offset
  }
}
