import md5 from 'md5'

// Default TextDecoder (utf-8) is faster than 'latin1' in V8 and works
// identically on the ASCII content CRAM stores here (read names, sequence
// bases, BAM Z tag values). Lazy so that consumers (e.g. older Node) have a
// chance to set up the global before first decode.
let textDecoder: TextDecoder | undefined
function getTextDecoder() {
  if (!textDecoder) {
    textDecoder = new TextDecoder()
  }
  return textDecoder
}

/**
 * Decode a string that may carry a trailing NUL, as a read name or a Z/H tag
 * value does.
 *
 * Whether there is a terminator to strip is not a coin flip — each caller is
 * one way or the other, every time. Counted over every indexed fixture:
 *
 * - **read names: 92,736 with no NUL, 0 with one.** Their codec is
 *   byteArrayStop with a stop byte of 0, so it has already consumed the
 *   terminator and there is none left to find.
 * - **Z tag values: 93,007 with a NUL, 0 without.** CRAM stores them terminated
 *   as BAM does, so the NUL is the last byte.
 *
 * Aggregated those are a 50/50 split, which is what makes scanning for the
 * terminator look unavoidable. Testing the *last* byte instead settles it in
 * O(1): a read name then decodes with no scan and no `subarray` — the latter
 * being a Uint8Array allocated once per record only to be thrown away.
 */
export function readNullTerminatedStringFromBuffer(buffer: Uint8Array) {
  const length = buffer.length
  if (length === 0 || buffer[length - 1] !== 0) {
    return getTextDecoder().decode(buffer)
  }
  // terminated, so find where the string actually ends — all but always at
  // `length - 1`, but a value with an embedded NUL still ends at the first one
  let end = 0
  while (buffer[end] !== 0) {
    end++
  }
  return getTextDecoder().decode(buffer.subarray(0, end))
}

export function decodeUtf8(buffer: Uint8Array) {
  return getTextDecoder().decode(buffer)
}

export function itf8Size(v: number) {
  if (!(v & ~0x7f)) {
    return 1
  }
  if (!(v & ~0x3fff)) {
    return 2
  }
  if (!(v & ~0x1fffff)) {
    return 3
  }
  if (!(v & ~0xfffffff)) {
    return 4
  }
  return 5
}

// Cursor object used by the no-allocation parseItf8/parseLtf8 callers
// (codecs/external.ts, and BufferReader, which is itself one). The cursor is
// just `{ bytePosition: number }` — matches the shape used elsewhere in the
// decode pipeline.
export interface ByteCursor {
  bytePosition: number
}

// Canonical ITF8 parser — cursor-mutating, no per-call allocation.
// See CRAMv3 §2.3 (Integer types): https://samtools.github.io/hts-specs/CRAMv3.pdf
export function parseItf8(buffer: Uint8Array, cursor: ByteCursor): number {
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

// LTF8 encodes the byte count in the leading 1 bits of the first byte: n
// leading ones mean n further bytes follow, and the first byte's remaining low
// bits are the value's most significant bits (0xFF, all ones, has none — eight
// bytes follow). Accumulating by multiplication rather than shifting is what
// keeps this correct past 32 bits: `a << 24 | b << 16 | c << 8 | d` is a signed
// int32, so any word whose top byte is >= 0x80 came out negative and the value
// was ~2^32 too small.
// Cursor-mutating like parseItf8, so neither allocates per field.
// See CRAMv3 §2.3 (Integer types): https://samtools.github.io/hts-specs/CRAMv3.pdf
export function parseLtf8(buffer: Uint8Array, cursor: ByteCursor) {
  const offset = cursor.bytePosition
  const firstByte = buffer[offset]!
  const extraBytes = Math.clz32(~firstByte & 0xff) - 24
  let value = firstByte & (0xff >> extraBytes)
  for (let i = 1; i <= extraBytes; i++) {
    value = value * 256 + buffer[offset + i]!
  }
  cursor.bytePosition = offset + extraBytes + 1
  return value
}

export function parseItem<T>(
  buffer: Uint8Array,
  parser: (buffer: Uint8Array, offset: number) => { offset: number; value: T },
  startBufferPosition = 0,
  startFilePosition = 0,
) {
  const { offset, value } = parser(buffer, startBufferPosition)
  return {
    ...value,
    _endPosition: offset + startFilePosition,
    _size: offset - startBufferPosition,
  }
}
export function sequenceMD5(seq: string) {
  return md5(seq.toUpperCase().replaceAll(/[^\u0021-\u007e]/g, ''))
}
