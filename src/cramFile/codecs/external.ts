import CramCodec, { Cursors } from './_base.ts'
import { CramUnimplementedError } from '../../errors.ts'
import { ExternalCramEncoding } from '../encoding.ts'
import { CramFileBlock } from '../file.ts'
import { CramBufferOverrunError } from './getBits.ts'
import CramSlice from '../slice/index.ts'

function parseItf8Inline(buffer: Uint8Array, cursor: { bytePosition: number }) {
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
  constructor(
    parameters: ExternalCramEncoding['parameters'],
    dataType: 'int' | 'byte',
  ) {
    super(parameters, dataType)
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
    const { blockContentId } = this.parameters
    const contentBlock = blocksByContentId[blockContentId]
    if (!contentBlock) {
      return undefined
    }

    const cursor = cursors.externalBlocks.getCursor(blockContentId)

    if (this.dataType === 'int') {
      return parseItf8Inline(contentBlock.content, cursor)
    } else {
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
