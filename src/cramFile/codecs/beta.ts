import CramCodec, { Cursors } from './_base'
import { getBits } from './getBits'
import { CramUnimplementedError } from '../../errors'
import { BetaEncoding } from '../encoding'
import { CramFileBlock } from '../file'
import CramSlice from '../slice'

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
    slice: CramSlice,
    coreDataBlock: CramFileBlock,
    blocksByContentId: Record<number, CramFileBlock>,
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
