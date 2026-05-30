import CramCodec, { type Cursors } from './_base.ts'
import {
  CramBufferOverrunError,
  CramMalformedError,
  CramUnimplementedError,
} from '../../errors.ts'
import { parseItf8 } from '../util.ts'

import type { ExternalCramEncoding } from '../encoding.ts'
import type { CramFileBlock } from '../file.ts'
import type CramSlice from '../slice/index.ts'

export { parseItf8 } from '../util.ts'

// Decode an entire buffer of ITF8 (variable-length int) values at once into
// an Int32Array. ITF8 uses the high bits of the first byte to encode length:
// 0xxxxxxx (1 byte, 7 bits), 10xxxxxx (2 bytes, 14 bits), 110xxxxx (3 bytes,
// 21 bits), 1110xxxx (4 bytes, 28 bits), 1111xxxx (5 bytes, 32 bits).
export function batchDecodeItf8(buffer: Uint8Array) {
  const result = new Int32Array(buffer.length)
  let count = 0
  let pos = 0
  const len = buffer.length

  while (pos < len) {
    const b0 = buffer[pos]!
    if (b0 < 0x80) {
      result[count++] = b0
      pos += 1
    } else if (b0 < 0xc0) {
      result[count++] = ((b0 & 0x3f) << 8) | buffer[pos + 1]!
      pos += 2
    } else if (b0 < 0xe0) {
      result[count++] =
        ((b0 & 0x1f) << 16) | (buffer[pos + 1]! << 8) | buffer[pos + 2]!
      pos += 3
    } else if (b0 < 0xf0) {
      result[count++] =
        ((b0 & 0x0f) << 24) |
        (buffer[pos + 1]! << 16) |
        (buffer[pos + 2]! << 8) |
        buffer[pos + 3]!
      pos += 4
    } else {
      result[count++] =
        ((b0 & 0x0f) << 28) |
        (buffer[pos + 1]! << 20) |
        (buffer[pos + 2]! << 12) |
        (buffer[pos + 3]! << 4) |
        (buffer[pos + 4]! & 0x0f)
      pos += 5
    }
  }

  return result.subarray(0, count)
}

export default class ExternalCodec extends CramCodec<
  'int' | 'byte',
  ExternalCramEncoding['parameters']
> {
  private blockContentId: number

  constructor(
    parameters: ExternalCramEncoding['parameters'],
    dataType: 'int' | 'byte',
  ) {
    super(parameters, dataType)
    this.blockContentId = parameters.blockContentId
    if (this.dataType !== 'int' && this.dataType !== 'byte') {
      throw new CramUnimplementedError(
        `${this.dataType} decoding not yet implemented by EXTERNAL codec`,
      )
    }
  }

  decode(
    _slice: CramSlice,
    _coreDataBlock: CramFileBlock,
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    if (this.dataType === 'int') {
      const preDecoded = cursors.preDecodedIntBlocks?.get(this.blockContentId)
      if (preDecoded) {
        return preDecoded.values[preDecoded.index++]!
      }
      const contentBlock = blocksByContentId[this.blockContentId]
      if (!contentBlock) {
        throw new CramMalformedError(
          `no block found with content ID ${this.blockContentId}`,
        )
      }
      const cursor = cursors.externalBlocks.getCursor(this.blockContentId)
      return parseItf8(contentBlock.content, cursor)
    } else {
      const contentBlock = blocksByContentId[this.blockContentId]
      if (!contentBlock) {
        throw new CramMalformedError(
          `no block found with content ID ${this.blockContentId}`,
        )
      }
      const cursor = cursors.externalBlocks.getCursor(this.blockContentId)
      if (cursor.bytePosition >= contentBlock.content.length) {
        throw new CramBufferOverrunError(
          'attempted to read beyond end of block. this file seems truncated.',
        )
      }
      return contentBlock.content[cursor.bytePosition++]!
    }
  }

  getBytesSubarray(
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
    length: number,
  ): Uint8Array | undefined {
    const { blockContentId } = this.parameters
    const contentBlock = blocksByContentId[blockContentId]
    if (!contentBlock) {
      return undefined
    }

    const cursor = cursors.externalBlocks.getCursor(blockContentId)
    const start = cursor.bytePosition
    const end = start + length

    if (end > contentBlock.content.length) {
      throw new CramBufferOverrunError(
        'attempted to read beyond end of block. this file seems truncated.',
      )
    }

    cursor.bytePosition = end
    return contentBlock.content.subarray(start, end)
  }
}
