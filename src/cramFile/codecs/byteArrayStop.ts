import CramCodec, { type Cursor, type Cursors } from './_base.ts'
import { CramMalformedError } from '../../errors.ts'
import type { ByteArrayStopCramEncoding } from '../encoding.ts'
import type { CramFileBlock } from '../file.ts'
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
    const startPosition = cursor.bytePosition
    const len = dataBuffer.length
    let stopPosition = startPosition
    while (stopPosition < len && dataBuffer[stopPosition] !== stopByte) {
      stopPosition++
    }
    if (stopPosition >= len) {
      throw new CramBufferOverrunError(
        'byteArrayStop reading beyond length of data buffer?',
      )
    }
    cursor.bytePosition = stopPosition + 1
    return dataBuffer.subarray(startPosition, stopPosition)
  }
}
