// @ts-nocheck
export default class Stream {
  readByte() {
    throw new Error('abstract method readByte() not implemented')
  }
  read(buffer, bufOffset, length) {
    let bytesRead = 0
    while (bytesRead < length) {
      const c = this.readByte()
      if (c < 0) {
        // EOF
        return bytesRead === 0 ? -1 : bytesRead
      }
      buffer[bufOffset++] = c
      bytesRead++
    }
    return bytesRead
  }
  writeByte(_byte) {
    throw new Error('abstract method readByte() not implemented')
  }
  seek(new_pos) {
    throw new Error('abstract method seek() not implemented')
  }
  write(buffer, bufOffset, length) {
    let i
    for (i = 0; i < length; i++) {
      this.writeByte(buffer[bufOffset++])
    }
    return length
  }
  flush() {}
}
