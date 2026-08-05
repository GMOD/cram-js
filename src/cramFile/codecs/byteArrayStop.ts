import CramCodec from './_base.ts'
import { CramBufferOverrunError, CramMalformedError } from '../../errors.ts'
import { decodeUtf8, readNullTerminatedStringFromBuffer } from '../util.ts'

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

  bindStringReader(
    _coreDataBlock: CramFileBlock | undefined,
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    const { blockContentId, stopByte } = this.parameters
    const contentBlock = blocksByContentId[blockContentId]
    if (!contentBlock) {
      return undefined
    }
    const content = contentBlock.content
    const cursor = cursors.externalBlocks.getCursor(blockContentId)
    const stopChar = String.fromCharCode(stopByte)

    // decoded on the first read rather than at bind time: a slice whose records
    // never reach this series — read names on a file that stores none — should
    // not decode the block to find out
    let block: string | undefined
    // whether a byte offset into the block is also a character offset into the
    // decoded string, which holds exactly when every byte decoded to one
    // character. CRAM read names and Z tag values are ASCII by spec, so this is
    // the case in practice; anything else falls through to decoding per value
    let flat = false

    return () => {
      if (block === undefined) {
        block = decodeUtf8(content)
        flat = block.length === content.length
      }
      if (flat) {
        const start = cursor.bytePosition
        // native, and reading the string the cursor points at rather than an
        // index into a precomputed table — so a block shared with another codec
        // stays correct with no bookkeeping to keep in step
        const end = block.indexOf(stopChar, start)
        if (end !== -1) {
          cursor.bytePosition = end + 1
          // The stop byte ends the *value*; a string inside it may still carry
          // its own terminator, as a Z tag does — CRAM delimits those with a
          // tab and leaves BAM's trailing NUL in place. Strip it the way
          // readNullTerminatedStringFromBuffer would, cutting at the first NUL
          // rather than the last byte so an embedded one still truncates.
          return block.slice(
            start,
            end > start && block.charCodeAt(end - 1) === 0
              ? block.indexOf('\0', start)
              : end,
          )
        }
      }
      // no terminator ahead, or the block is not flat. Fall back, and let
      // readToStop raise the overrun if the block really is exhausted.
      return readNullTerminatedStringFromBuffer(
        readToStop(content, cursor, stopByte),
      )
    }
  }
}
