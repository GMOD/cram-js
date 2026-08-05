import CramCodec, {
  type Cursor,
  type Cursors,
  type PreDecodedIntBlock,
} from './_base.ts'
import {
  CramBufferOverrunError,
  CramMalformedError,
  CramUnimplementedError,
} from '../../errors.ts'
import { parseItf8 } from '../util.ts'

import type { ExternalCramEncoding } from '../encoding.ts'
import type { CramFileBlock } from '../file.ts'

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

  // Every ITF8 value occupies at least one byte, so buffer.length is a safe
  // upper bound on the count — but a block of mostly multi-byte values leaves
  // the scratch array several times larger than needed, and a subarray would
  // pin all of it for as long as the slice stays cached. Copy out when the
  // overhang is large enough to be worth the copy.
  return count * 2 < result.length
    ? result.slice(0, count)
    : result.subarray(0, count)
}

// The reads themselves, written once and shared by the per-call `decode` and
// the per-slice `bindDecoder` — the difference between the two is only how much
// of the lookup each has already done, never what the bytes mean.
function nextInt(preDecoded: PreDecodedIntBlock) {
  const value = preDecoded.values[preDecoded.index++]
  if (value === undefined) {
    throw new CramBufferOverrunError(
      'attempted to read beyond end of block. this file seems truncated.',
    )
  }
  return value
}

function nextByte(content: Uint8Array, cursor: Cursor) {
  if (cursor.bytePosition >= content.length) {
    throw new CramBufferOverrunError(
      'attempted to read beyond end of block. this file seems truncated.',
    )
  }
  return content[cursor.bytePosition++]!
}

function takeBytes(content: Uint8Array, cursor: Cursor, length: number) {
  const start = cursor.bytePosition
  const end = start + length
  if (end > content.length) {
    throw new CramBufferOverrunError(
      'attempted to read beyond end of block. this file seems truncated.',
    )
  }
  cursor.bytePosition = end
  return content.subarray(start, end)
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
    _coreDataBlock: CramFileBlock,
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    if (this.dataType === 'int') {
      const preDecoded = cursors.preDecodedIntBlocks?.get(this.blockContentId)
      if (preDecoded) {
        return nextInt(preDecoded)
      }
      const cursor = cursors.externalBlocks.getCursor(this.blockContentId)
      return parseItf8(this.contentOf(blocksByContentId), cursor)
    }
    const cursor = cursors.externalBlocks.getCursor(this.blockContentId)
    return nextByte(this.contentOf(blocksByContentId), cursor)
  }

  private contentOf(blocksByContentId: Record<number, CramFileBlock>) {
    const contentBlock = blocksByContentId[this.blockContentId]
    if (!contentBlock) {
      throw new CramMalformedError(
        `no block found with content ID ${this.blockContentId}`,
      )
    }
    return contentBlock.content
  }

  bindDecoder(
    _coreDataBlock: CramFileBlock | undefined,
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    const id = this.blockContentId
    // A block every accessor treats as an int has been ITF8-decoded up front,
    // so reading one is an array index — see preDecodeIntBlocks
    if (this.dataType === 'int') {
      const preDecoded = cursors.preDecodedIntBlocks?.get(id)
      if (preDecoded) {
        return () => nextInt(preDecoded)
      }
    }
    const contentBlock = blocksByContentId[id]
    if (!contentBlock) {
      // deferred rather than thrown here: a data series whose block is missing
      // is only a problem for a file that actually reads that series
      return () => {
        throw new CramMalformedError(`no block found with content ID ${id}`)
      }
    }
    const content = contentBlock.content
    const cursor = cursors.externalBlocks.getCursor(id)
    return this.dataType === 'int'
      ? () => parseItf8(content, cursor)
      : () => nextByte(content, cursor)
  }

  bindBytesReader(
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    const contentBlock = blocksByContentId[this.blockContentId]
    if (!contentBlock) {
      return undefined
    }
    const content = contentBlock.content
    const cursor = cursors.externalBlocks.getCursor(this.blockContentId)
    return (length: number) => takeBytes(content, cursor, length)
  }
}
