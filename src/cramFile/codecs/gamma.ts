import CramCodec, { Cursors } from './_base.ts'
import { getBits } from './getBits.ts'
import { CramUnimplementedError } from '../../errors.ts'
import { GammaEncoding } from '../encoding.ts'
import { CramFileBlock } from '../file.ts'
import CramSlice from '../slice/index.ts'

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
    _slice: CramSlice,
    coreDataBlock: CramFileBlock,
    _blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    let length = 1

    while (getBits(coreDataBlock.content, cursors.coreBlock, 1) === 0) {
      length = length + 1
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
