import { tinyMemoize } from '../util'

import CramCodec from './_base'

export default class ByteArrayStopCodec extends CramCodec {
  constructor(parameters = {}, dataType, instantiateCodec) {
    super(parameters, dataType)
    this.instantiateCodec = instantiateCodec
    if (dataType !== 'byteArray') {
      throw new TypeError(
        `byteArrayLength does not support data type ${dataType}`,
      )
    }
  }

  decode(slice, coreDataBlock, blocksByContentId, cursors) {
    const lengthCodec = this._getLengthCodec()
    const arrayLength = lengthCodec.decode(
      slice,
      coreDataBlock,
      blocksByContentId,
      cursors,
    )

    const dataCodec = this._getDataCodec()
    const data = new Uint8Array(arrayLength)
    for (let i = 0; i < arrayLength; i += 1) {
      data[i] = dataCodec.decode(
        slice,
        coreDataBlock,
        blocksByContentId,
        cursors,
      )
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

'_getLengthCodec _getDataCodec'
  .split(' ')
  .forEach(method => tinyMemoize(ByteArrayStopCodec, method))
