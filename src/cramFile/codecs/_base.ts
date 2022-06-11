import CramSlice from '../slice'
import { CramFileBlock } from '../file'
import { Int32, Int64, Int8 } from '../../branding'

export type DataType = 'int' | 'byte' | 'long' | 'byteArray' | 'byteArrayBlock'

export type Cursor = {
  bitPosition: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
  bytePosition: Int32
}

export type DecodedData = Int8 | Int32 | Int64 | Buffer | Uint8Array

export type Cursors = {
  lastAlignmentStart: number
  coreBlock: { bitPosition: number; bytePosition: number }
  externalBlocks: {
    map: Map<any, any>
    getCursor: (contentId: number) => Cursor
  }
}

// codec base class
export default abstract class CramCodec<TParameters = unknown> {
  public parameters: TParameters
  public dataType: DataType

  constructor(parameters: TParameters, dataType: DataType) {
    this.parameters = parameters
    this.dataType = dataType
  }

  abstract decode(
    slice: CramSlice,
    coreDataBlock: CramFileBlock,
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ): DecodedData
}
