import CramCodec, { type Cursors } from './_base.ts'
import { CramBufferOverrunError } from './getBits.ts'
import { CramUnimplementedError } from '../../errors.ts'

import type { ExternalCramEncoding } from '../encoding.ts'
import type { CramFileBlock } from '../file.ts'
import type CramSlice from '../slice/index.ts'

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

export function parseItf8(
  buffer: Uint8Array,
  cursor: { bytePosition: number },
) {
  const offset = cursor.bytePosition
  const countFlags = buffer[offset]!
  if (countFlags < 0x80) {
    cursor.bytePosition = offset + 1
    return countFlags
  }
  if (countFlags < 0xc0) {
    cursor.bytePosition = offset + 2
    return ((countFlags & 0x3f) << 8) | buffer[offset + 1]!
  }
  if (countFlags < 0xe0) {
    cursor.bytePosition = offset + 3
    return (
      ((countFlags & 0x1f) << 16) |
      (buffer[offset + 1]! << 8) |
      buffer[offset + 2]!
    )
  }
  if (countFlags < 0xf0) {
    cursor.bytePosition = offset + 4
    return (
      ((countFlags & 0x0f) << 24) |
      (buffer[offset + 1]! << 16) |
      (buffer[offset + 2]! << 8) |
      buffer[offset + 3]!
    )
  }
  cursor.bytePosition = offset + 5
  return (
    ((countFlags & 0x0f) << 28) |
    (buffer[offset + 1]! << 20) |
    (buffer[offset + 2]! << 12) |
    (buffer[offset + 3]! << 4) |
    (buffer[offset + 4]! & 0x0f)
  )
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
        return undefined
      }
      const cursor = cursors.externalBlocks.getCursor(this.blockContentId)
      return parseItf8(contentBlock.content, cursor)
    } else {
      const contentBlock = blocksByContentId[this.blockContentId]
      if (!contentBlock) {
        return undefined
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
