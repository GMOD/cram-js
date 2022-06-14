import { CramUnimplementedError } from '../../errors'
import CramCodec, { Cursors } from './_base'
import { getBits } from './getBits'
import CramSlice from '../slice'
import { CramFileBlock } from '../file'
import { SubexpEncoding } from '../encoding'
import {
  addInt32,
  assertInt32,
  decrementInt32,
  ensureInt32,
  incrementInt32,
  Int32,
  subtractInt32,
} from '../../branding'

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
    let numLeadingOnes = assertInt32(0)
    while (getBits(coreDataBlock.content, cursors.coreBlock, assertInt32(1))) {
      numLeadingOnes = incrementInt32(numLeadingOnes)
    }

    let b: Int32
    let n: Int32
    if (numLeadingOnes === 0) {
      b = this.parameters.K
      n = getBits(coreDataBlock.content, cursors.coreBlock, b)
    } else {
      b = decrementInt32(addInt32(numLeadingOnes, this.parameters.K))
      const bits = getBits(coreDataBlock.content, cursors.coreBlock, b)
      n = ensureInt32((1 << b) | bits)
    }

    return subtractInt32(n, this.parameters.offset)
  }
}
