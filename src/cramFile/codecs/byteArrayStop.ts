import CramCodec from './_base.ts'
import { CramBufferOverrunError, CramMalformedError } from '../../errors.ts'

import type { Cursor, Cursors } from './_base.ts'
import type { ByteArrayStopCramEncoding } from '../encoding.ts'
import type { CramFileBlock } from '../file.ts'

/** the scan itself, shared by the per-call `decode` and the per-slice binding */
function readToStop(content: Uint8Array, cursor: Cursor, stopByte: number) {
  const startPosition = cursor.bytePosition
  const len = content.length
  let stopPosition = startPosition
  while (stopPosition < len && content[stopPosition] !== stopByte) {
    stopPosition++
  }
  if (stopPosition >= len) {
    throw new CramBufferOverrunError(
      'byteArrayStop reading beyond length of data buffer?',
    )
  }
  cursor.bytePosition = stopPosition + 1
  return content.subarray(startPosition, stopPosition)
}

export default class ByteArrayStopCodec extends CramCodec<
  'byteArray',
  ByteArrayStopCramEncoding['parameters']
> {
  decode(
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
    return readToStop(contentBlock.content, cursor, this.parameters.stopByte)
  }

  bindDecoder(
    _coreDataBlock: CramFileBlock | undefined,
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    const { blockContentId, stopByte } = this.parameters
    const contentBlock = blocksByContentId[blockContentId]
    if (!contentBlock) {
      return () => {
        throw new CramMalformedError(
          `no block found with content ID ${blockContentId}`,
        )
      }
    }
    const content = contentBlock.content
    const cursor = cursors.externalBlocks.getCursor(blockContentId)
    return () => readToStop(content, cursor, stopByte)
  }
}
