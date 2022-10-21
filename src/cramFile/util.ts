import md5 from 'md5'
import { Parser } from '@gmod/binary-parser'
import { CramBufferOverrunError } from './codecs/getBits'

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

export function parseItf8(
  buffer: Uint8Array,
  initialOffset: number,
): [number, number] {
  let offset = initialOffset
  const countFlags = buffer[offset]
  let result
  if (countFlags < 0x80) {
    result = countFlags
    offset = offset + 1
  } else if (countFlags < 0xc0) {
    result = ((countFlags << 8) | buffer[offset + 1]) & 0x3fff
    offset = offset + 2
  } else if (countFlags < 0xe0) {
    result =
      ((countFlags << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2]) &
      0x1fffff
    offset = offset + 3
  } else if (countFlags < 0xf0) {
    result =
      ((countFlags << 24) |
        (buffer[offset + 1] << 16) |
        (buffer[offset + 2] << 8) |
        buffer[offset + 3]) &
      0x0fffffff
    offset = offset + 4
  } else {
    result =
      ((countFlags & 0x0f) << 28) |
      (buffer[offset + 1] << 20) |
      (buffer[offset + 2] << 12) |
      (buffer[offset + 3] << 4) |
      (buffer[offset + 4] & 0x0f)
    // x=((0xff & 0x0f)<<28) | (0xff<<20) | (0xff<<12) | (0xff<<4) | (0x0f & 0x0f);
    // TODO *val_p = uv < 0x80000000UL ? uv : -((int32_t) (0xffffffffUL - uv)) - 1;
    offset = offset + 5
  }
  if (offset > buffer.length) {
    throw new CramBufferOverrunError(
      'Attempted to read beyond end of buffer; this file seems truncated.',
    )
  }
  return [result, offset - initialOffset]
}

// parseLtf8(buffer, initialOffset) {
//   let offset = initialOffset
//   const countFlags = buffer[offset]
//   let result
//   if (countFlags < 0x80) {
//     result = countFlags
//     offset += 1
//   } else if (countFlags < 0xc0) {
//     result = ((buffer[offset] << 8) | buffer[offset + 1]) & 0x3fff
//     offset += 2
//   } else if (countFlags < 0xe0) {
//     result =
//       ((buffer[offset] << 16) |
//         (buffer[offset + 1] << 8) |
//         buffer[offset + 2]) &
//       0x1fffff
//     offset += 3
//   } else if (countFlags < 0xf0) {
//     result =
//       ((buffer[offset] << 24) |
//         (buffer[offset + 1] << 16) |
//         (buffer[offset + 2] << 8) |
//         buffer[offset + 3]) &
//       0x0fffffff
//     offset += 4
//   } else if (countFlags < 0xf8) {
//     result =
//       ((buffer[offset] & 15) * Math.pow(2,32) + (buffer[offset + 1] << 24)) |
//       ((buffer[offset + 2] << 16) |
//         (buffer[offset + 3] << 8) |
//         buffer[offset + 4])
//     // TODO *val_p = uv < 0x80000000UL ? uv : -((int32_t) (0xffffffffUL - uv)) - 1;
//     offset += 5
//   } else if (countFlags < 0xfc) {
//     result =
//       ((((buffer[offset] & 7) << 8) | buffer[offset + 1]) * Math.pow(2,32) +
//         (buffer[offset + 2] << 24)) |
//       ((buffer[offset + 3] << 16) |
//         (buffer[offset + 4] << 8) |
//         buffer[offset + 5])
//     offset += 6
//   } else if (countFlags < 0xfe) {
//     result =
//       ((((buffer[offset] & 3) << 16) |
//         (buffer[offset + 1] << 8) |
//         buffer[offset + 2]) *
//         Math.pow(2,32) +
//         (buffer[offset + 3] << 24)) |
//       ((buffer[offset + 4] << 16) |
//         (buffer[offset + 5] << 8) |
//         buffer[offset + 6])
//     offset += 7
//   } else if (countFlags < 0xff) {
//     result = Long.fromBytesBE(buffer.slice(offset + 1, offset + 8))
//     if (
//       result.greaterThan(Number.MAX_SAFE_INTEGER) ||
//       result.lessThan(Number.MIN_SAFE_INTEGER)
//     )
//       throw new CramUnimplementedError('integer overflow')
//     result = result.toNumber()
//     offset += 8
//   } else {
//     result = Long.fromBytesBE(buffer.slice(offset + 1, offset + 9))
//     if (
//       result.greaterThan(Number.MAX_SAFE_INTEGER) ||
//       result.lessThan(Number.MIN_SAFE_INTEGER)
//     )
//       throw new CramUnimplementedError('integer overflow')
//     result = result.toNumber()
//     offset += 9
//   }
//   return [result, offset - initialOffset]
// },

export type ParsedItem<T> = T & {
  _endPosition: number
  _size: number
}

export function parseItem<T>(
  buffer: Buffer,
  parser: Parser<T>,
  startBufferPosition = 0,
  startFilePosition = 0,
): ParsedItem<T> {
  const { offset, result } = parser.parse(buffer)
  return {
    ...result,
    _endPosition: offset + startFilePosition,
    _size: offset - startBufferPosition,
  }
}

// this would be nice as a decorator, but i'm a little worried about
// babel support for it going away or changing.
// memoizes a method in the stupidest possible way, with no regard for the
// arguments.  actually, this only works on methods that take no arguments
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
  return md5(seq.toUpperCase().replace(/[^\x21-\x7e]/g, ''))
}
