import { CramUnimplementedError } from '../../errors'
import CramCodec, { Cursors } from './_base'
import { getBits } from './getBits'
import CramSlice from '../slice'
import { CramFileBlock } from '../file'
import { SubexpEncoding } from '../encoding'

export default class SubexpCodec extends CramCodec<
  'int',
  SubexpEncoding['parameters']
> {
  constructor(parameters: SubexpEncoding['parameters'], dataType: 'int') {
    super(parameters, dataType)
    if (this.dataType !== 'int') {
      throw new CramUnimplementedError(
        `${this.dataType} decoding not yet implemented by SUBEXP codec`,
      )
    }
  }

  decode(
    slice: CramSlice,
    coreDataBlock: CramFileBlock,
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    let numLeadingOnes = 0
    while (getBits(coreDataBlock.content, cursors.coreBlock, 1)) {
      numLeadingOnes = numLeadingOnes + 1
    }

    let b: number
    let n: number
    if (numLeadingOnes === 0) {
      b = this.parameters.K
      n = getBits(coreDataBlock.content, cursors.coreBlock, b)
    } else {
      b = numLeadingOnes + this.parameters.K - 1
      const bits = getBits(coreDataBlock.content, cursors.coreBlock, b)
      n = (1 << b) | bits
    }

    return n - this.parameters.offset
  }
}
