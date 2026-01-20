import CramCodec, { Cursor, Cursors } from './_base.ts'
import { CramUnimplementedError } from '../../errors.ts'
import { BetaEncoding } from '../encoding.ts'
import { CramFileBlock } from '../file.ts'
import CramSlice from '../slice/index.ts'
import { wasmDecodeBetaBulk } from './wasmCodecs.ts'

export default class BetaCodec extends CramCodec<
  'int',
  BetaEncoding['parameters']
> {
  constructor(parameters: BetaEncoding['parameters'], dataType: 'int') {
    super(parameters, dataType)
    if (this.dataType !== 'int') {
      throw new CramUnimplementedError(
        `${this.dataType} decoding not yet implemented by BETA codec`,
      )
    }
  }

  decode(
    _slice: CramSlice,
    coreDataBlock: CramFileBlock,
    _blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    return decodeBetaInline(
      coreDataBlock.content,
      cursors.coreBlock,
      this.parameters.length,
      this.parameters.offset,
    )
  }

  decodeBulk(
    coreDataBlock: CramFileBlock,
    cursors: Cursors,
    count: number,
  ): Int32Array {
    const result = wasmDecodeBetaBulk(
      coreDataBlock.content,
      cursors.coreBlock,
      this.parameters.length,
      this.parameters.offset,
      count,
    )
    if (!result) {
      throw new Error('WASM beta decode failed')
    }
    return result
  }
}

/**
 * Optimized beta decoder with inlined bit reading.
 */
function decodeBetaInline(
  data: Uint8Array,
  cursor: Cursor,
  numBits: number,
  offset: number,
): number {
  let { bytePosition, bitPosition } = cursor

  // Fast path: reading exactly 8 bits when byte-aligned
  if (numBits === 8 && bitPosition === 7) {
    const val = data[bytePosition]!
    cursor.bytePosition = bytePosition + 1
    return val - offset
  }

  // General case
  let val = 0
  for (let i = 0; i < numBits; i++) {
    val <<= 1
    val |= (data[bytePosition]! >> bitPosition) & 1
    bitPosition -= 1
    if (bitPosition < 0) {
      bytePosition += 1
      bitPosition = 7
    }
  }

  cursor.bytePosition = bytePosition
  cursor.bitPosition = bitPosition as Cursor['bitPosition']
  return val - offset
}

