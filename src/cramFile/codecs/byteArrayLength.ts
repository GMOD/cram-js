import CramCodec, { Cursors } from './_base'
import { ByteArrayLengthEncoding, CramEncoding } from '../encoding'
import { CramFileBlock } from '../file'
import CramSlice from '../slice'
import { DataType } from './dataSeriesTypes'
import { tinyMemoize } from '../util'

type CramCodecFactory = <TData extends DataType = DataType>(
  encodingData: CramEncoding,
  dataType: TData | 'ignore',
) => CramCodec<TData>

export default class ByteArrayStopCodec extends CramCodec<
  'byteArray',
  ByteArrayLengthEncoding['parameters']
> {
  private instantiateCodec: CramCodecFactory

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

    const dataCodec = this._getDataCodec()
    const data = new Uint8Array(arrayLength)
    for (let i = 0; i < arrayLength; i += 1) {
      data[i] =
        dataCodec.decode(slice, coreDataBlock, blocksByContentId, cursors) || 0
    }

    return data
  }

  // memoize
  _getLengthCodec() {
    const encodingParams = this.parameters.lengthsEncoding
    return this.instantiateCodec(encodingParams, 'int')
  }

  // memoize
  _getDataCodec() {
    const encodingParams = this.parameters.valuesEncoding
    return this.instantiateCodec(encodingParams, 'byte')
  }
}

'_getLengthCodec _getDataCodec'.split(' ').forEach(method => {
  tinyMemoize(ByteArrayStopCodec, method)
})
