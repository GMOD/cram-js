const CramCodec = require('./_base')

class ByteArrayStopCodec extends CramCodec {
  constructor(parameters = {}, dataType, instantiateCodec) {
    super(parameters, dataType)
    this.instantiateCodec = instantiateCodec
    if (dataType !== 'byteArray')
      throw new Error(`byteArrayLength does not support data type ${dataType}`)
  }

  decode(slice, coreDataBlock, blocksByContentId, cursors, numItems = 1) {
    if (numItems !== 1) throw new Error('decoding multiple items not supported')

    const lengthCodec = this._getLengthCodec()
    const arrayLength = lengthCodec.decode(
      slice,
      coreDataBlock,
      blocksByContentId,
      cursors,
    )

    const dataCodec = this._getDataCodec()
    const data = new Array(arrayLength)
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

  _getDataCodec() {
    const encodingParams = this.parameters.valuesEncoding

    return this.instantiateCodec(encodingParams, 'byte')
  }
}

module.exports = ByteArrayStopCodec
