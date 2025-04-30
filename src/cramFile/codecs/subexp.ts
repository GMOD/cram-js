import CramCodec, { Cursors } from './_base.ts'
import { getBits } from './getBits.ts'
import { CramUnimplementedError } from '../../errors.ts'
import { SubexpEncoding } from '../encoding.ts'
import { CramFileBlock } from '../file.ts'
import CramSlice from '../slice/index.ts'

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
    _slice: CramSlice,
    coreDataBlock: CramFileBlock,
    _blocksByContentId: Record<number, CramFileBlock>,
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
