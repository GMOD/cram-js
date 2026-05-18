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

export function readNullTerminatedStringFromBuffer(buffer: Uint8Array) {
  let end = 0
  while (end < buffer.length && buffer[end] !== 0) {
    end++
  }
  return getTextDecoder().decode(buffer.subarray(0, end))
}

export function decodeUtf8(buffer: Uint8Array) {
  return getTextDecoder().decode(buffer)
}

export const TWO_PWR_16_DBL = 1 << 16
export const TWO_PWR_32_DBL = TWO_PWR_16_DBL * TWO_PWR_16_DBL
export const TWO_PWR_64_DBL = TWO_PWR_32_DBL * TWO_PWR_32_DBL
export const TWO_PWR_24_DBL = 1 << 24
export const TWO_PWR_56_DBL = TWO_PWR_24_DBL * TWO_PWR_32_DBL

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

// Cursor object used by the no-allocation hot-path parseItf8/parseLtf8 callers
// (codecs/external.ts). The cursor is just `{ bytePosition: number }` —
// matches the shape used elsewhere in the decode pipeline.
export interface ByteCursor {
  bytePosition: number
}

// Canonical ITF8 parser — cursor-mutating, no per-call allocation. Used by
// the hot path. The tuple-returning parseItf8Sized below is a thin wrapper
// for section parsers that work in terms of `let offset` arithmetic.
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

// Tuple-returning wrapper for callers that prefer offset arithmetic
// (sectionParsers.ts). Allocates one cursor + one tuple per call — fine for
// section parsing (called O(slices) times) but not for the byte-decode loop.
export function parseItf8Sized(
  buffer: Uint8Array,
  offset: number,
): readonly [number, number] {
  const cursor = { bytePosition: offset }
  const value = parseItf8(buffer, cursor)
  return [value, cursor.bytePosition - offset] as const
}

export function parseLtf8(buffer: Uint8Array, initialOffset: number) {
  let offset = initialOffset
  const countFlags = buffer[offset]!
  let value: number

  // Single byte value < 0x80
  if (countFlags < 0x80) {
    value = countFlags
    offset += 1
  }
  // Two byte value < 0xC0
  else if (countFlags < 0xc0) {
    value = ((countFlags << 8) | buffer[offset + 1]!) & 0x3fff
    offset += 2
  }
  // Three byte value < 0xE0
  else if (countFlags < 0xe0) {
    value =
      ((countFlags & 0x3f) << 16) |
      (buffer[offset + 1]! << 8) |
      buffer[offset + 2]!
    offset += 3
  }
  // Four byte value < 0xF0
  else if (countFlags < 0xf0) {
    value =
      ((countFlags & 0x1f) << 24) |
      (buffer[offset + 1]! << 16) |
      (buffer[offset + 2]! << 8) |
      buffer[offset + 3]!
    offset += 4
  }
  // Five byte value < 0xF8
  else if (countFlags < 0xf8) {
    value =
      (buffer[offset]! & 0x0f) * TWO_PWR_32_DBL +
      ((buffer[offset + 1]! << 24) |
        (buffer[offset + 2]! << 16) |
        (buffer[offset + 3]! << 8) |
        buffer[offset + 4]!)
    offset += 5
  }
  // Six byte value < 0xFC
  else if (countFlags < 0xfc) {
    value =
      (((buffer[offset]! & 0x07) << 8) | buffer[offset + 1]!) * TWO_PWR_32_DBL +
      ((buffer[offset + 2]! << 24) |
        (buffer[offset + 3]! << 16) |
        (buffer[offset + 4]! << 8) |
        buffer[offset + 5]!)
    offset += 6
  }
  // Seven byte value < 0xFE
  else if (countFlags < 0xfe) {
    value =
      (((buffer[offset]! & 0x03) << 16) |
        (buffer[offset + 1]! << 8) |
        buffer[offset + 2]!) *
        TWO_PWR_32_DBL +
      ((buffer[offset + 3]! << 24) |
        (buffer[offset + 4]! << 16) |
        (buffer[offset + 5]! << 8) |
        buffer[offset + 6]!)
    offset += 7
  }
  // Eight byte value < 0xFF
  else if (countFlags < 0xff) {
    value =
      ((buffer[offset + 1]! << 24) |
        (buffer[offset + 2]! << 16) |
        (buffer[offset + 3]! << 8) |
        buffer[offset + 4]!) *
        TWO_PWR_32_DBL +
      ((buffer[offset + 5]! << 24) |
        (buffer[offset + 6]! << 16) |
        (buffer[offset + 7]! << 8) |
        buffer[offset + 8]!)
    offset += 8
  }
  // Nine byte value
  else {
    value =
      buffer[offset + 1]! * TWO_PWR_56_DBL +
      ((buffer[offset + 2]! << 24) |
        (buffer[offset + 3]! << 16) |
        (buffer[offset + 4]! << 8) |
        buffer[offset + 5]!) *
        TWO_PWR_32_DBL +
      ((buffer[offset + 6]! << 24) |
        (buffer[offset + 7]! << 16) |
        (buffer[offset + 8]! << 8) |
        buffer[offset + 9]!)
    offset += 9
  }

  return [value, offset - initialOffset] as const
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
