import CramSlice from '../slice'
import { CramFileBlock } from '../file'
import { Int32, Int64, Int8 } from '../../branding'
import { DataType } from './dataSeriesTypes'

export type DataTypeMapping = {
  byte: Int8
  int: Int32
  long: Int64
  byteArray: Uint8Array
}

export type Cursor = {
  bitPosition: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
  bytePosition: Int32
}

export type Cursors = {
  lastAlignmentStart: Int32
  coreBlock: Cursor
  externalBlocks: {
    map: Map<any, any>
    getCursor: (contentId: number) => Cursor
  }
}

// codec base class
export default abstract class CramCodec<
  TResult extends DataType = DataType,
  TParameters = unknown,
> {
  public parameters: TParameters
  public dataType: DataType

  constructor(parameters: TParameters, dataType: TResult) {
    this.parameters = parameters
    this.dataType = dataType
  }

  abstract decode(
    slice: CramSlice,
    coreDataBlock: CramFileBlock,
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ): DataTypeMapping[TResult]
}
