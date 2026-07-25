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

// LTF8 encodes the byte count in the leading 1 bits of the first byte: n
// leading ones mean n further bytes follow, and the first byte's remaining low
// bits are the value's most significant bits (0xFF, all ones, has none — eight
// bytes follow). Accumulating by multiplication rather than shifting is what
// keeps this correct past 32 bits: `a << 24 | b << 16 | c << 8 | d` is a signed
// int32, so any word whose top byte is >= 0x80 came out negative and the value
// was ~2^32 too small.
// See CRAMv3 §2.3 (Integer types): https://samtools.github.io/hts-specs/CRAMv3.pdf
export function parseLtf8(buffer: Uint8Array, initialOffset: number) {
  const firstByte = buffer[initialOffset]!
  const extraBytes = Math.clz32(~firstByte & 0xff) - 24
  let value = firstByte & (0xff >> extraBytes)
  for (let i = 1; i <= extraBytes; i++) {
    value = value * 256 + buffer[initialOffset + i]!
  }
  return [value, extraBytes + 1] as const
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
