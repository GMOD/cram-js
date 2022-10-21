import { CramMalformedError } from '../../errors'

import CramCodec, { Cursor, Cursors } from './_base'
import CramSlice from '../slice'
import { CramFileBlock } from '../file'
import { ByteArrayStopCramEncoding } from '../encoding'
import { CramBufferOverrunError } from './getBits'

export default class ByteArrayStopCodec extends CramCodec<
  'byteArray',
  ByteArrayStopCramEncoding['parameters']
> {
  constructor(
    parameters: ByteArrayStopCramEncoding['parameters'],
    dataType: 'byteArray',
  ) {
    super(parameters, dataType)
    if (dataType !== 'byteArray') {
      throw new TypeError(
        `byteArrayStop codec does not support data type ${dataType}`,
      )
    }
  }

  decode(
    slice: CramSlice,
    coreDataBlock: CramFileBlock,
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    const { blockContentId } = this.parameters
    const contentBlock = blocksByContentId[blockContentId]
    if (!contentBlock) {
      throw new CramMalformedError(
        `no block found with content ID ${blockContentId}`,
      )
    }
    const cursor = cursors.externalBlocks.getCursor(blockContentId)
    return this._decodeByteArray(contentBlock, cursor)
  }

  _decodeByteArray(contentBlock: CramFileBlock, cursor: Cursor) {
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
      stopPosition = stopPosition + 1
    }
    cursor.bytePosition = stopPosition + 1
    return dataBuffer.subarray(startPosition, stopPosition)
  }
}
