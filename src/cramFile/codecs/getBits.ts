export class CramBufferOverrunError extends Error {}

export function getBits(
  data: any,
  cursor: { bytePosition: number; bitPosition: number },
  numBits: any,
) {
  let val = 0
  if (
    cursor.bytePosition + (7 - cursor.bitPosition + numBits) / 8 >
    data.length
  ) {
    throw new CramBufferOverrunError(
      'read error during decoding. the file seems to be truncated.',
    )
  }
  for (let dlen = numBits; dlen; dlen -= 1) {
    // get the next `dlen` bits in the input, put them in val
    val <<= 1
    val |= (data[cursor.bytePosition] >> cursor.bitPosition) & 1
    cursor.bitPosition -= 1
    if (cursor.bitPosition < 0) {
      cursor.bytePosition += 1
    }
    cursor.bitPosition &= 7
  }
  return val
}
