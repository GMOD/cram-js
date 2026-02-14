export class CramBufferOverrunError extends Error {
  readonly code = 'CRAM_BUFFER_OVERRUN' as const
}

export function getBits(
  data: Uint8Array,
  cursor: { bytePosition: number; bitPosition: number },
  numBits: number,
) {
  if (
    cursor.bytePosition + (7 - cursor.bitPosition + numBits) / 8 >
    data.length
  ) {
    throw new CramBufferOverrunError(
      'read error during decoding. the file seems to be truncated.',
    )
  }

  // Fast path: reading exactly 8 bits when byte-aligned
  if (numBits === 8 && cursor.bitPosition === 7) {
    const val = data[cursor.bytePosition]!
    cursor.bytePosition += 1
    return val
  }

  // Fast path: reading exactly 1 bit
  if (numBits === 1) {
    const val = (data[cursor.bytePosition]! >> cursor.bitPosition) & 1
    cursor.bitPosition -= 1
    if (cursor.bitPosition < 0) {
      cursor.bytePosition += 1
      cursor.bitPosition = 7
    }
    return val
  }

  // General case: bit-by-bit loop
  let val = 0
  for (let dlen = numBits; dlen; dlen--) {
    val <<= 1
    val |= (data[cursor.bytePosition]! >> cursor.bitPosition) & 1
    cursor.bitPosition -= 1
    if (cursor.bitPosition < 0) {
      cursor.bytePosition += 1
    }
    cursor.bitPosition &= 7
  }
  return val
}
