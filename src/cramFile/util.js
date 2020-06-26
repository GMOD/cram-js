const md5 = require('md5')
const { CramBufferOverrunError } = require('../errors')

module.exports = {
  itf8Size(v) {
    if (!(v & ~0x7f)) return 1
    if (!(v & ~0x3fff)) return 2
    if (!(v & ~0x1fffff)) return 3
    if (!(v & ~0xfffffff)) return 4
    return 5
  },

  parseItf8(buffer, initialOffset) {
    let offset = initialOffset
    const countFlags = buffer[offset]
    let result
    if (countFlags < 0x80) {
      result = countFlags
      offset += 1
    } else if (countFlags < 0xc0) {
      result = ((countFlags << 8) | buffer[offset + 1]) & 0x3fff
      offset += 2
    } else if (countFlags < 0xe0) {
      result =
        ((countFlags << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2]) &
        0x1fffff
      offset += 3
    } else if (countFlags < 0xf0) {
      result =
        ((countFlags << 24) |
          (buffer[offset + 1] << 16) |
          (buffer[offset + 2] << 8) |
          buffer[offset + 3]) &
        0x0fffffff
      offset += 4
    } else {
      result =
        ((countFlags & 0x0f) << 28) |
        (buffer[offset + 1] << 20) |
        (buffer[offset + 2] << 12) |
        (buffer[offset + 3] << 4) |
        (buffer[offset + 4] & 0x0f)
      // x=((0xff & 0x0f)<<28) | (0xff<<20) | (0xff<<12) | (0xff<<4) | (0x0f & 0x0f);
      // TODO *val_p = uv < 0x80000000UL ? uv : -((int32_t) (0xffffffffUL - uv)) - 1;
      offset += 5
    }
    if (offset > buffer.length) {
      throw new CramBufferOverrunError(
        'Attempted to read beyond end of buffer; this file seems truncated.',
      )
    }
    return [result, offset - initialOffset]
  },

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

  parseItem(buffer, parser, startBufferPosition = 0, startFilePosition = 0) {
    const { offset, result } = parser.parse(buffer)
    result._endPosition = offset + startFilePosition
    result._size = offset - startBufferPosition
    return result
  },

  // this would be nice as a decorator, but i'm a little worried about
  // babel support for it going away or changing.
  // memoizes a method in the stupidest possible way, with no regard for the
  // arguments.  actually, this only works on methods that take no arguments
  tinyMemoize(_class, methodName) {
    const method = _class.prototype[methodName]
    const memoAttrName = `_memo_${methodName}`
    _class.prototype[methodName] = function _tinyMemoized() {
      if (!(memoAttrName in this)) {
        const res = method.call(this)
        this[memoAttrName] = res
        Promise.resolve(res).catch(err => {
          delete this[memoAttrName]
          throw err
        })
      }
      return this[memoAttrName]
    }
  },

  sequenceMD5(seq) {
    return md5(seq.toUpperCase().replace(/[^\x21-\x7e]/g, ''))
  },
}
