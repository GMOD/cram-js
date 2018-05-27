const validDataTypes = {
  int: true,
  byte: true,
}

/** codec base class */
class CramCodec {
  constructor(parameters = {}, dataType) {
    this.parameters = parameters
    this.dataType = dataType
    if (!dataType)
      throw new Error('must provide a data type to codec constructor')
    if (!validDataTypes[dataType])
      throw new Error(`invalid data type ${dataType}`)
  }

  // decode(slice, coreDataBlock, blocksByContentId, cursors) {
  // }
}

module.exports = CramCodec
