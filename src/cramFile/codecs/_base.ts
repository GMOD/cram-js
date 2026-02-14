import { CramFileBlock } from '../file.ts'
import { DataType } from './dataSeriesTypes.ts'
import CramSlice from '../slice/index.ts'

export interface DataTypeMapping {
  byte: number
  int: number
  long: number
  byteArray: Uint8Array
}

export interface Cursor {
  bitPosition: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
  bytePosition: number
}

export interface Cursors {
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
  ): DataTypeMapping[TResult] | undefined

  getBytesSubarray(
    _blocksByContentId: Record<number, CramFileBlock>,
    _cursors: Cursors,
    _length: number,
  ): Uint8Array | undefined {
    return undefined
  }
}
