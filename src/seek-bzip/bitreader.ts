/*
node-bzip - a pure-javascript Node.JS module for decoding bzip2 data

Copyright (C) 2012 Eli Skeggs

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Adapted from bzip2.js, copyright 2011 antimatter15 (antimatter15@gmail.com).

Based on micro-bunzip by Rob Landley (rob@landley.net).

Based on bzip2 decompression code by Julian R Seward (jseward@acm.org),
which also acknowledges contributions by Mike Burrows, David Wheeler,
Peter Fenwick, Alistair Moffat, Radford Neal, Ian H. Witten,
Robert Sedgewick, and Jon L. Bentley.
*/

import { toHex } from './toHex.ts'

const BITMASK = [0x00, 0x01, 0x03, 0x07, 0x0f, 0x1f, 0x3f, 0x7f, 0xff]

interface Stream {
  readByte(): number
  seek(pos: number): void
}

export default class BitReader {
  private stream: Stream
  private bitOffset: number
  private curByte: number
  private hasByte: boolean

  constructor(stream: Stream) {
    this.stream = stream
    this.bitOffset = 0
    this.curByte = 0
    this.hasByte = false
  }

  private _ensureByte(): void {
    if (!this.hasByte) {
      this.curByte = this.stream.readByte()
      this.hasByte = true
    }
  }

  /**
   * Reads bits from the buffer
   * @param bits Number of bits to read
   */
  read(bits: number): number {
    let result = 0
    while (bits > 0) {
      this._ensureByte()
      const remaining = 8 - this.bitOffset
      // if we're in a byte
      if (bits >= remaining) {
        result <<= remaining
        result |= BITMASK[remaining]! & this.curByte
        this.hasByte = false
        this.bitOffset = 0
        bits -= remaining
      } else {
        result <<= bits
        const shift = remaining - bits
        result |= (this.curByte & (BITMASK[bits]! << shift)) >> shift
        this.bitOffset += bits
        bits = 0
      }
    }
    return result
  }

  /**
   * Seek to an arbitrary point in the buffer (expressed in bits)
   * @param pos Position in bits
   */
  seek(pos: number): void {
    const n_bit = pos % 8
    const n_byte = (pos - n_bit) / 8
    this.bitOffset = n_bit
    this.stream.seek(n_byte)
    this.hasByte = false
  }

  /**
   * Reads 6 bytes worth of data using the read method
   */
  pi(): string {
    const buf = new Uint8Array(6)
    for (let i = 0; i < buf.length; i++) {
      buf[i] = this.read(8)
    }
    return toHex(buf)
  }
}
