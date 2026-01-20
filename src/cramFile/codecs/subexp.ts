import CramCodec, { Cursor, Cursors } from './_base.ts'
import { CramUnimplementedError } from '../../errors.ts'
import { SubexpEncoding } from '../encoding.ts'
import { CramFileBlock } from '../file.ts'
import CramSlice from '../slice/index.ts'
import { wasmDecodeSubexpBulk } from './wasmCodecs.ts'

export default class SubexpCodec extends CramCodec<
  'int',
  SubexpEncoding['parameters']
> {
  constructor(parameters: SubexpEncoding['parameters'], dataType: 'int') {
    super(parameters, dataType)
    if (this.dataType !== 'int') {
      throw new CramUnimplementedError(
        `${this.dataType} decoding not yet implemented by SUBEXP codec`,
      )
    }
  }

  decode(
    _slice: CramSlice,
    coreDataBlock: CramFileBlock,
    _blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    return decodeSubexpInline(
      coreDataBlock.content,
      cursors.coreBlock,
      this.parameters.K,
      this.parameters.offset,
    )
  }

  decodeBulk(
    coreDataBlock: CramFileBlock,
    cursors: Cursors,
    count: number,
  ): Int32Array {
    const result = wasmDecodeSubexpBulk(
      coreDataBlock.content,
      cursors.coreBlock,
      this.parameters.K,
      this.parameters.offset,
      count,
    )
    if (!result) {
      throw new Error('WASM subexp decode failed')
    }
    return result
  }
}

/**
 * Optimized subexp decoder with inlined bit reading.
 */
function decodeSubexpInline(
  data: Uint8Array,
  cursor: Cursor,
  K: number,
  offset: number,
): number {
  let { bytePosition, bitPosition } = cursor

  // Count leading ones (inline single-bit reads)
  let numLeadingOnes = 0
  while (true) {
    const bit = (data[bytePosition]! >> bitPosition) & 1
    bitPosition -= 1
    if (bitPosition < 0) {
      bytePosition += 1
      bitPosition = 7
    }
    if (bit === 0) {
      break
    }
    numLeadingOnes += 1
  }

  // Determine how many bits to read for the value
  const b = numLeadingOnes === 0 ? K : numLeadingOnes + K - 1

  // Read b bits
  let bits = 0
  for (let i = 0; i < b; i++) {
    bits <<= 1
    bits |= (data[bytePosition]! >> bitPosition) & 1
    bitPosition -= 1
    if (bitPosition < 0) {
      bytePosition += 1
      bitPosition = 7
    }
  }

  cursor.bytePosition = bytePosition
  cursor.bitPosition = bitPosition as Cursor['bitPosition']

  const n = numLeadingOnes === 0 ? bits : (1 << b) | bits
  return n - offset
}

