import CramCodec, { Cursors } from './_base.ts'
import { getBits } from './getBits.ts'
import { CramUnimplementedError } from '../../errors.ts'
import { BetaEncoding } from '../encoding.ts'
import { CramFileBlock } from '../file.ts'
import CramSlice from '../slice/index.ts'

export default class BetaCodec extends CramCodec<
  'int',
  BetaEncoding['parameters']
> {
  constructor(parameters: BetaEncoding['parameters'], dataType: 'int') {
    super(parameters, dataType)
    if (this.dataType !== 'int') {
      throw new CramUnimplementedError(
        `${this.dataType} decoding not yet implemented by BETA codec`,
      )
    }
  }

  decode(
    _slice: CramSlice,
    coreDataBlock: CramFileBlock,
    _blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    const fromBits = getBits(
      coreDataBlock.content,
      cursors.coreBlock,
      this.parameters.length,
    )
    return fromBits - this.parameters.offset
  }
}
