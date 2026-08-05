import { describe, expect, it } from 'vitest'

import { parseLtf8, sequenceMD5 } from '../src/cramFile/util.ts'

// reference LTF8 encoder, written from CRAMv3 §2.3 rather than from the parser:
// n leading 1 bits in the first byte mean n bytes follow, and the first byte's
// remaining low bits hold the value's most significant bits
function encodeLtf8(value: bigint) {
  for (let extraBytes = 0; extraBytes < 8; extraBytes++) {
    const payloadBits = 7 - extraBytes
    if (value < 1n << BigInt(payloadBits + 8 * extraBytes)) {
      const prefix = (0xff << (8 - extraBytes)) & 0xff
      const bytes = [prefix | Number(value >> BigInt(8 * extraBytes))]
      for (let i = extraBytes - 1; i >= 0; i--) {
        bytes.push(Number((value >> BigInt(8 * i)) & 0xffn))
      }
      return bytes
    }
  }
  const bytes = [0xff]
  for (let i = 7; i >= 0; i--) {
    bytes.push(Number((value >> BigInt(8 * i)) & 0xffn))
  }
  return bytes
}

describe('util.parseLtf8', () => {
  // Every width boundary, and either side of it. The values above 2^31 are the
  // regression guard: the old implementation OR'd four bytes into a signed
  // int32, so a low word with its top bit set came out negative and the value
  // was ~2^32 too small. The 8- and 9-byte forms also read one byte too many.
  // Only exactly-representable values are used — past 2^53 a double cannot hold
  // an arbitrary LTF8, so asserting a rounded value would prove nothing.
  const boundaries = [7, 14, 21, 28, 35, 42, 49].map(bits => 1n << BigInt(bits))
  const values = [
    0n,
    1n,
    0x7fn,
    3_000_000_000n,
    0x7fffffffn,
    0x80000000n,
    0xffffffffn,
    ...boundaries.flatMap(b => [b - 1n, b]),
    1n << 53n, // 8-byte form
    1n << 56n, // 9-byte form
    1n << 63n,
  ]

  it.each(values)('round-trips %s', value => {
    const encoded = encodeLtf8(value)
    // pad so an over-read past the field would be visibly nonzero
    const buffer = Uint8Array.from([...encoded, 0xff, 0xff, 0xff, 0xff])
    // cursor-mutating, so the advance is checked through the cursor rather
    // than returned — which is the point: no tuple allocated per field
    const cursor = { bytePosition: 0 }
    expect(parseLtf8(buffer, cursor)).toEqual(Number(value))
    expect(cursor.bytePosition).toEqual(encoded.length)
  })

  it('reads from a nonzero offset', () => {
    const buffer = Uint8Array.from([0x11, 0x22, ...encodeLtf8(3_000_000_000n)])
    const cursor = { bytePosition: 2 }
    expect(parseLtf8(buffer, cursor)).toEqual(3_000_000_000)
    expect(cursor.bytePosition).toEqual(7)
  })
})

describe('util.sequenceMD5', () => {
  ;[
    [
      `ACGTACGTACGT ACGtAC GTACGT...
    12345!!!`,
      'dfabdbb36e239a6da88957841f32b8e4',
    ],
    [
      'AGCATGTTAGAT  AA**GATAGCTGTGCTAGTAGGCAGTCAGCGCCAT',
      'caad65b937c4bc0b33c08f62a9fb5411',
    ],
  ].forEach(([input, output]) => {
    it(`can calculate MD5 of ${input} correctly`, () => {
      expect(sequenceMD5(input!)).toEqual(output)
    })
  })
})
