import md5 from 'md5'

import { CramBufferOverrunError } from './codecs/getBits'
import { longFromBytesToUnsigned } from './long'

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
  if (countFlags < 0x80) {
    result = countFlags
    offset = offset + 1
  } else if (countFlags < 0xc0) {
    result = ((countFlags << 8) | buffer[offset + 1]!) & 0x3fff
    offset = offset + 2
  } else if (countFlags < 0xe0) {
    result =
      ((countFlags << 16) | (buffer[offset + 1]! << 8) | buffer[offset + 2]!) &
      0x1fffff
    offset = offset + 3
  } else if (countFlags < 0xf0) {
    result =
      ((countFlags << 24) |
        (buffer[offset + 1]! << 16) |
        (buffer[offset + 2]! << 8) |
        buffer[offset + 3]!) &
      0x0fffffff
    offset = offset + 4
  } else {
    result =
      ((countFlags & 0x0f) << 28) |
      (buffer[offset + 1]! << 20) |
      (buffer[offset + 2]! << 12) |
      (buffer[offset + 3]! << 4) |
      (buffer[offset + 4]! & 0x0f)
    // x=((0xff & 0x0f)<<28) | (0xff<<20) | (0xff<<12) | (0xff<<4) | (0x0f & 0x0f);
    // TODO *val_p = uv < 0x80000000UL ? uv : -((int32_t) (0xffffffffUL - uv)) - 1;
    offset = offset + 5
  }
  if (offset > buffer.length) {
    throw new CramBufferOverrunError(
      'Attempted to read beyond end of buffer; this file seems truncated.',
    )
  }
  return [result, offset - initialOffset] as const
}

export function parseLtf8(buffer: Uint8Array, initialOffset: number) {
  const dataView = new DataView(buffer.buffer)
  let offset = initialOffset
  const countFlags = buffer[offset]!
  let n: number
  if (countFlags < 0x80) {
    n = countFlags
    offset += 1
  } else if (countFlags < 0xc0) {
    n = ((buffer[offset]! << 8) | buffer[offset + 1]!) & 0x3fff
    offset += 2
  } else if (countFlags < 0xe0) {
    n =
      ((buffer[offset]! << 16) |
        (buffer[offset + 1]! << 8) |
        buffer[offset + 2]!) &
      0x1fffff
    n = ((countFlags & 63) << 16) | dataView.getUint16(offset + 1, true)
    offset += 3
  } else if (countFlags < 0xf0) {
    n =
      ((buffer[offset]! << 24) |
        (buffer[offset + 1]! << 16) |
        (buffer[offset + 2]! << 8) |
        buffer[offset + 3]!) &
      0x0fffffff
    offset += 4
  } else if (countFlags < 0xf8) {
    n =
      ((buffer[offset]! & 15) * 2 ** 32 + (buffer[offset + 1]! << 24)) |
      ((buffer[offset + 2]! << 16) |
        (buffer[offset + 3]! << 8) |
        buffer[offset + 4]!)
    // TODO *val_p = uv < 0x80000000UL ? uv : -((int32_t) (0xffffffffUL - uv)) - 1;
    offset += 5
  } else if (countFlags < 0xfc) {
    n =
      ((((buffer[offset]! & 7) << 8) | buffer[offset + 1]!) * 2 ** 32 +
        (buffer[offset + 2]! << 24)) |
      ((buffer[offset + 3]! << 16) |
        (buffer[offset + 4]! << 8) |
        buffer[offset + 5]!)
    offset += 6
  } else if (countFlags < 0xfe) {
    n =
      ((((buffer[offset]! & 3) << 16) |
        (buffer[offset + 1]! << 8) |
        buffer[offset + 2]!) *
        2 ** 32 +
        (buffer[offset + 3]! << 24)) |
      ((buffer[offset + 4]! << 16) |
        (buffer[offset + 5]! << 8) |
        buffer[offset + 6]!)
    offset += 7
  } else if (countFlags < 0xff) {
    n = longFromBytesToUnsigned(buffer.subarray(offset + 1, offset + 8))
    offset += 8
  } else {
    n = longFromBytesToUnsigned(buffer.subarray(offset + 1, offset + 9))
    offset += 9
  }
  return [n, offset - initialOffset] as const
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

// this would be nice as a decorator, but i'm a little worried about babel
// support for it going away or changing. memoizes a method in the stupidest
// possible way, with no regard for the arguments.  actually, this only works
// on methods that take no arguments
export function tinyMemoize(_class: any, methodName: any) {
  const method = _class.prototype[methodName]
  const memoAttrName = `_memo_${methodName}`
  _class.prototype[methodName] = function _tinyMemoized() {
    if (!(memoAttrName in this)) {
      const res = method.call(this)
      this[memoAttrName] = res
      Promise.resolve(res).catch(() => {
        delete this[memoAttrName]
      })
    }
    return this[memoAttrName]
  }
}

export function sequenceMD5(seq: string) {
  return md5(seq.toUpperCase().replaceAll(/[^\u0021-\u007e]/g, ''))
}
