import CramCodec, { Cursor, Cursors } from './_base.ts'
import { CramUnimplementedError } from '../../errors.ts'
import { GammaEncoding } from '../encoding.ts'
import { CramFileBlock } from '../file.ts'
import CramSlice from '../slice/index.ts'

export default class GammaCodec extends CramCodec<
  'int',
  GammaEncoding['parameters']
> {
  constructor(parameters: GammaEncoding['parameters'], dataType: 'int') {
    super(parameters, dataType)
    if (this.dataType !== 'int') {
      throw new CramUnimplementedError(
        `${this.dataType} decoding not yet implemented by GAMMA codec`,
      )
    }
  }

  decode(
    _slice: CramSlice,
    coreDataBlock: CramFileBlock,
    _blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    return decodeGammaInline(
      coreDataBlock.content,
      cursors.coreBlock,
      this.parameters.offset,
    )
  }
}

/**
 * Optimized gamma decoder with inlined bit reading.
 * Avoids function call overhead by inlining the getBits logic.
 */
function decodeGammaInline(
  data: Uint8Array,
  cursor: Cursor,
  offset: number,
): number {
  let { bytePosition, bitPosition } = cursor
  let length = 1

  // Count leading zeros (each 0 bit increases length)
  // Inline single-bit reads for the while loop
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const bit = (data[bytePosition]! >> bitPosition) & 1
    bitPosition -= 1
    if (bitPosition < 0) {
      bytePosition += 1
      bitPosition = 7
    }
    if (bit === 1) {
      break
    }
    length += 1
  }

  // Now read (length - 1) more bits for the value
  let readBits = 0
  const bitsToRead = length - 1
  if (bitsToRead > 0) {
    // Optimized multi-bit read
    for (let i = 0; i < bitsToRead; i++) {
      readBits <<= 1
      readBits |= (data[bytePosition]! >> bitPosition) & 1
      bitPosition -= 1
      if (bitPosition < 0) {
        bytePosition += 1
        bitPosition = 7
      }
    }
  }

  // Update cursor
  cursor.bytePosition = bytePosition
  cursor.bitPosition = bitPosition as Cursor['bitPosition']

  const value = readBits | (1 << (length - 1))
  return value - offset
}

/**
 * Bulk decode multiple gamma values at once.
 * More efficient than calling decode() in a loop due to reduced overhead.
 */
export function decodeGammaBulk(
  data: Uint8Array,
  cursor: Cursor,
  offset: number,
  count: number,
): Int32Array {
  const results = new Int32Array(count)
  let { bytePosition, bitPosition } = cursor

  for (let n = 0; n < count; n++) {
    let length = 1

    // Count leading zeros
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const bit = (data[bytePosition]! >> bitPosition) & 1
      bitPosition -= 1
      if (bitPosition < 0) {
        bytePosition += 1
        bitPosition = 7
      }
      if (bit === 1) {
        break
      }
      length += 1
    }

    // Read (length - 1) more bits
    let readBits = 0
    const bitsToRead = length - 1
    for (let i = 0; i < bitsToRead; i++) {
      readBits <<= 1
      readBits |= (data[bytePosition]! >> bitPosition) & 1
      bitPosition -= 1
      if (bitPosition < 0) {
        bytePosition += 1
        bitPosition = 7
      }
    }

    results[n] = (readBits | (1 << (length - 1))) - offset
  }

  cursor.bytePosition = bytePosition
  cursor.bitPosition = bitPosition

  return results
}
