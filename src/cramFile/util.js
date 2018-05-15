module.exports = {
  itf8Size(v) {
    if (!(v & ~0x7f)) return 1
    if (!(v & ~0x3fff)) return 2
    if (!(v & ~0x1fffff)) return 3
    if (!(v & ~0xfffffff)) return 4
    return 5
  },

  parseItem(buffer, parser, startBufferOffset = 0, startFileOffset = 0) {
    const { offset, result } = parser.parse(buffer)
    result._endOffset = offset + startFileOffset
    result._size = offset - startBufferOffset
    return result
  },
}
