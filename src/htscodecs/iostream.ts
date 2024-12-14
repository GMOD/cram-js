// @ts-nocheck

/*
 * Copyright (c) 2019 Genome Research Ltd.
 * Author(s): James Bonfield
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 *    1. Redistributions of source code must retain the above copyright notice,
 *       this list of conditions and the following disclaimer.
 *
 *    2. Redistributions in binary form must reproduce the above
 *       copyright notice, this list of conditions and the following
 *       disclaimer in the documentation and/or other materials provided
 *       with the distribution.
 *
 *    3. Neither the names Genome Research Ltd and Wellcome Trust Sanger
 *       Institute nor the names of its contributors may be used to endorse
 *       or promote products derived from this software without specific
 *       prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY GENOME RESEARCH LTD AND CONTRIBUTORS "AS
 * IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
 * TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
 * PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL GENOME RESEARCH
 * LTD OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// Turn a buffer into a fake stream with get / put commands.
// This enables up to closely match the published pseudocode.
export default class IOStream {
  buf: Uint8Array
  length: number
  pos: number
  dataView: DataView

  constructor(buf: Uint8Array, start_pos = 0, size = 0) {
    if (size !== 0) {
      this.buf = new Uint8Array(size)
      this.length = size
    } else {
      this.buf = buf
      this.length = buf.length
    }
    this.dataView = new DataView(this.buf.buffer)
    this.pos = start_pos
  }

  // ----------
  // Reading
  EOF() {
    return this.pos >= this.length
  }

  ReadData(len: number) {
    const A = this.buf.slice(this.pos, this.pos + len)
    this.pos += len
    return A
  }

  ReadByte() {
    const b = this.buf[this.pos]!
    this.pos++
    return b
  }

  ReadChar() {
    const b = this.buf[this.pos]!
    this.pos++
    return String.fromCharCode(b)
  }

  ReadUint16() {
    let i = this.ReadByte()
    i |= this.ReadByte() << 8
    return i
  }

  ReadUint32() {
    const i = this.dataView.getInt32(this.pos, true)
    this.pos += 4
    return i
  }

  // nul terminated string
  ReadString() {
    let s = ''
    let b: number
    do {
      b = this.buf[this.pos++]!
      if (b) {
        s += String.fromCharCode(b)
      }
    } while (b)
    return s
  }

  ReadUint7() {
    // Variable sized unsigned integers
    let i = 0
    let c: number
    do {
      c = this.ReadByte()
      i = (i << 7) | (c & 0x7f)
    } while (c & 0x80)

    return i
  }

  ReadITF8() {
    let i = this.buf[this.pos]!
    this.pos++

    // process.stderr.write("i="+i+"\n");

    if (i >= 0xf0) {
      // 1111xxxx => +4 bytes
      i = (i & 0x0f) << 28
      i +=
        (this.buf[this.pos + 0]! << 20) +
        (this.buf[this.pos + 1]! << 12) +
        (this.buf[this.pos + 2]! << 4) +
        (this.buf[this.pos + 3]! >> 4)
      this.pos += 4
      // process.stderr.write("  4i="+i+"\n");
    } else if (i >= 0xe0) {
      // 1110xxxx => +3 bytes
      i = (i & 0x0f) << 24
      i +=
        (this.buf[this.pos + 0]! << 16) +
        (this.buf[this.pos + 1]! << 8) +
        (this.buf[this.pos + 2]! << 0)
      this.pos += 3
      // process.stderr.write("  3i="+i+"\n");
    } else if (i >= 0xc0) {
      // 110xxxxx => +2 bytes
      i = (i & 0x1f) << 16
      i += (this.buf[this.pos + 0]! << 8) + (this.buf[this.pos + 1]! << 0)
      this.pos += 2
      // process.stderr.write("  2i="+i+"\n");
    } else if (i >= 0x80) {
      // 10xxxxxx => +1 bytes
      i = (i & 0x3f) << 8
      i += this.buf[this.pos]!
      this.pos++
    } else {
      // 0xxxxxxx => +0 bytes
    }

    return i
  }
}
