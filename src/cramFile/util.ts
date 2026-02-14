import md5 from 'md5'

const textDecoder = new TextDecoder('latin1')

export function readNullTerminatedStringFromBuffer(buffer: Uint8Array) {
  let end = 0
  while (end < buffer.length && buffer[end] !== 0) {
    end++
  }
  return textDecoder.decode(buffer.subarray(0, end))
}

export function decodeLatin1(buffer: Uint8Array) {
  return textDecoder.decode(buffer)
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

export function parseItf8(buffer: Uint8Array, initialOffset: number) {
  let offset = initialOffset
  const countFlags = buffer[offset]!
  let result: number

  // Single byte value (0xxxxxxx)
  if (countFlags < 0x80) {
    result = countFlags
    offset += 1
  }
  // Two byte value (10xxxxxx)
  else if (countFlags < 0xc0) {
    result = ((countFlags & 0x3f) << 8) | buffer[offset + 1]!
    offset += 2
  }
  // Three byte value (110xxxxx)
  else if (countFlags < 0xe0) {
    result =
      ((countFlags & 0x1f) << 16) |
      (buffer[offset + 1]! << 8) |
      buffer[offset + 2]!
    offset += 3
  }
  // Four byte value (1110xxxx)
  else if (countFlags < 0xf0) {
    result =
      ((countFlags & 0x0f) << 24) |
      (buffer[offset + 1]! << 16) |
      (buffer[offset + 2]! << 8) |
      buffer[offset + 3]!
    offset += 4
  }
  // Five byte value (11110xxx)
  else {
    result =
      ((countFlags & 0x0f) << 28) |
      (buffer[offset + 1]! << 20) |
      (buffer[offset + 2]! << 12) |
      (buffer[offset + 3]! << 4) |
      (buffer[offset + 4]! & 0x0f)
    offset += 5
  }

  return [result, offset - initialOffset] as const
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
export function tinyMemoize(_class: any, methodName: any) {
  const method = _class.prototype[methodName]
  const memoAttrName = `_memo_${methodName}`
  _class.prototype[methodName] = function _tinyMemoized() {
    let res = this[memoAttrName]
    if (res === undefined) {
      res = method.call(this)
      this[memoAttrName] = res
      Promise.resolve(res).catch(() => {
        delete this[memoAttrName]
      })
    }
    return res
  }
}

export function sequenceMD5(seq: string) {
  return md5(seq.toUpperCase().replaceAll(/[^\u0021-\u007e]/g, ''))
}
