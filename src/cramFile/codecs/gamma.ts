import { CramUnimplementedError } from '../../errors'
import CramCodec, { Cursors } from './_base'
import { getBits } from './getBits'
import { GammaEncoding } from '../encoding'
import CramSlice from '../slice'
import { CramFileBlock } from '../file'
import {
  assertInt32,
  decrementInt32,
  ensureInt32,
  incrementInt32,
  Int32,
  subtractInt32,
} from '../../branding'

export default class GammaCodec extends CramCodec<
  'int',
  GammaEncoding['parameters']
> {
  constructor(parameters: GammaEncoding['parameters'], dataType: 'int') {
    super(parameters, dataType)
    if (this.dataType !== 'int') {
      throw new CramUnimplementedError(
        `${this.dataType} decoding not yet implemented by GAMMA codec`,
      )
    }
  }

  decode(
    slice: CramSlice,
    coreDataBlock: CramFileBlock,
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    let length: Int32 = assertInt32(1)

    while (
      getBits(coreDataBlock.content, cursors.coreBlock, assertInt32(1)) === 0
    ) {
      length = incrementInt32(length)
    }

    const readBits = getBits(
      coreDataBlock.content,
      cursors.coreBlock,
      decrementInt32(length),
    )

    const value = readBits | (1 << (length - 1))
    return subtractInt32(ensureInt32(value), this.parameters.offset)
  }
}
