import CramCodec from './_base.ts'
import { CramBufferOverrunError, CramUnimplementedError } from '../../errors.ts'

import type { Cursor, Cursors } from './_base.ts'
import type { SubexpEncoding } from '../encoding.ts'
import type { CramFileBlock } from '../file.ts'

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

  // Count leading ones (inline single-bit reads). A truncated core block reads
  // as `undefined >> n`, i.e. as a zero bit, so past the end this loop would
  // stop and the value below would decode out of bytes that are not there —
  // silently wrong rather than reported truncated. Same guard `gamma` carries.
  let numLeadingOnes = 0
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    if (bytePosition >= data.length) {
      throw new CramBufferOverrunError(
        'read beyond end of core block; file seems truncated',
      )
    }
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
  if ((data.length - bytePosition) * 8 - (7 - bitPosition) < b) {
    throw new CramBufferOverrunError(
      'read beyond end of core block; file seems truncated',
    )
  }
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
