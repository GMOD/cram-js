import { CramBufferOverrunError, CramMalformedError } from '../../errors'

import CramCodec from './_base'

export default class ByteArrayStopCodec extends CramCodec {
  constructor(parameters = {}, dataType) {
    super(parameters, dataType)
    if (dataType === 'byteArray') {
      this._decode = this._decodeByteArray
    } else {
      throw new TypeError(
        `byteArrayStop codec does not support data type ${dataType}`,
      )
    }
  }

  decode(slice, coreDataBlock, blocksByContentId, cursors) {
    const { blockContentId } = this.parameters
    const contentBlock = blocksByContentId[blockContentId]
    if (!contentBlock) {
      throw new CramMalformedError(
        `no block found with content ID ${blockContentId}`,
      )
    }
    const cursor = cursors.externalBlocks.getCursor(blockContentId)
    return this._decode(contentBlock, cursor)
  }

  _decodeByteArray(contentBlock, cursor) {
    const dataBuffer = contentBlock.content
    const { stopByte } = this.parameters
    // scan to the next stop byte
    const startPosition = cursor.bytePosition
    let stopPosition = cursor.bytePosition
    while (
      dataBuffer[stopPosition] !== stopByte &&
      stopPosition < dataBuffer.length
    ) {
      if (stopPosition === dataBuffer.length) {
        throw new CramBufferOverrunError(
          `byteArrayStop reading beyond length of data buffer?`,
        )
      }
      stopPosition += 1
    }
    cursor.bytePosition = stopPosition + 1
    const data = dataBuffer.slice(startPosition, stopPosition)
    return data
  }
}
