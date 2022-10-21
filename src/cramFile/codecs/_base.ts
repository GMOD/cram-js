import CramSlice from '../slice'
import { CramFileBlock } from '../file'
import { DataType } from './dataSeriesTypes'

export type DataTypeMapping = {
  byte: number
  int: number
  long: number
  byteArray: Uint8Array
}

export type Cursor = {
  bitPosition: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
  bytePosition: number
}

export type Cursors = {
  lastAlignmentStart: number
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
