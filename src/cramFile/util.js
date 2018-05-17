module.exports = {
  itf8Size(v) {
    if (!(v & ~0x7f)) return 1
    if (!(v & ~0x3fff)) return 2
    if (!(v & ~0x1fffff)) return 3
    if (!(v & ~0xfffffff)) return 4
    return 5
  },

  parseItem(buffer, parser, startBufferPosition = 0, startFilePosition = 0) {
    const { offset, result } = parser.parse(buffer)
    result._endPosition = offset + startFilePosition
    result._size = offset - startBufferPosition
    return result
  },
}
