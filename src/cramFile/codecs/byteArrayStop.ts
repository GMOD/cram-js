import CramCodec, { Cursor, Cursors } from './_base.ts'
import { CramMalformedError } from '../../errors.ts'
import { ByteArrayStopCramEncoding } from '../encoding.ts'
import { CramFileBlock } from '../file.ts'
import { CramBufferOverrunError } from './getBits.ts'
import CramSlice from '../slice/index.ts'

export default class ByteArrayStopCodec extends CramCodec<
  'byteArray',
  ByteArrayStopCramEncoding['parameters']
> {
  decode(
    _slice: CramSlice,
    _coreDataBlock: CramFileBlock,
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
          'byteArrayStop reading beyond length of data buffer?',
        )
      }
      stopPosition = stopPosition + 1
    }
    cursor.bytePosition = stopPosition + 1
    return dataBuffer.subarray(startPosition, stopPosition)
  }
}
