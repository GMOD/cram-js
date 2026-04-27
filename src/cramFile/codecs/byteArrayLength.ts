import CramCodec, { type Cursors } from './_base.ts'

import type { ByteArrayLengthEncoding, CramEncoding } from '../encoding.ts'
import type { CramFileBlock } from '../file.ts'
import type { DataType } from './dataSeriesTypes.ts'
import type CramSlice from '../slice/index.ts'

type CramCodecFactory = <TData extends DataType = DataType>(
  encodingData: CramEncoding,
  dataType: TData | 'ignore',
) => CramCodec<TData>

export default class ByteArrayStopCodec extends CramCodec<
  'byteArray',
  ByteArrayLengthEncoding['parameters']
> {
  private instantiateCodec: CramCodecFactory
  private _lengthCodecCache?: CramCodec<'int'>
  private _dataCodecCache?: CramCodec<'byte'>

  constructor(
    parameters: ByteArrayLengthEncoding['parameters'],
    dataType: 'byteArray',
    instantiateCodec: CramCodecFactory,
  ) {
    super(parameters, dataType)
    this.instantiateCodec = instantiateCodec
  }

  decode(
    slice: CramSlice,
    coreDataBlock: CramFileBlock,
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    const lengthCodec = this._getLengthCodec()
    const arrayLength =
      lengthCodec.decode(slice, coreDataBlock, blocksByContentId, cursors) || 0

    if (arrayLength > 0) {
      const dataCodec = this._getDataCodec()
      const subarray = dataCodec.getBytesSubarray(
        blocksByContentId,
        cursors,
        arrayLength,
      )
      if (subarray) {
        return subarray
      } else {
        const data = new Uint8Array(arrayLength)
        for (let i = 0; i < arrayLength; i += 1) {
          data[i] =
            dataCodec.decode(
              slice,
              coreDataBlock,
              blocksByContentId,
              cursors,
            ) || 0
        }
        return data
      }
    } else {
      return new Uint8Array(0)
    }
  }

  _getLengthCodec() {
    this._lengthCodecCache ??= this.instantiateCodec(
      this.parameters.lengthsEncoding,
      'int',
    )
    return this._lengthCodecCache
  }

  _getDataCodec() {
    this._dataCodecCache ??= this.instantiateCodec(
      this.parameters.valuesEncoding,
      'byte',
    )
    return this._dataCodecCache
  }
}
