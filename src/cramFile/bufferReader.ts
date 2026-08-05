import { CramBufferOverrunError } from '../errors.ts'
import { parseItf8, parseLtf8 } from './util.ts'

/**
 * A moving read position over a buffer, for the section parsers.
 *
 * They used to thread `offset` by hand — every field was
 * `const [v, advance] = parseItf8(buffer, offset); offset += advance`, forty-odd
 * times, with the `advance` bindings numbered inconsistently against the fields
 * they belonged to. That tuple is an allocation per field, and several parsers
 * allocated a `DataView` on top of it just to read a `u32`.
 *
 * A reader is one allocation per parsed section instead, because `parseItf8`
 * already takes a mutable `{ bytePosition }` cursor and this *is* that cursor —
 * `itf8()` passes `this` straight through. Reading the width-tagged integers
 * this way costs nothing per field.
 *
 * Everything here assumes little-endian, as the rest of the decode does;
 * `CramFile` refuses to run on a big-endian machine.
 */
export default class BufferReader {
  /** the read position — this object is the `ByteCursor` `parseItf8` takes */
  bytePosition: number
  private buffer: Uint8Array

  constructor(buffer: Uint8Array, offset = 0) {
    this.buffer = buffer
    this.bytePosition = offset
  }

  /**
   * Reading past the end of the buffer is what running off the end of the file
   * looks like, and it has to be an error rather than a run of `undefined`.
   *
   * This used to come for free: the parsers read their fixed-width fields
   * through a `DataView`, which range-checks and throws. That is load-bearing
   * well beyond reporting a truncated file — `CramFile.containerCount` walks
   * containers until one fails to parse, so without a throw here the walk never
   * terminates. Checking explicitly says so, and gives a better message than
   * the `RangeError` it replaces.
   */
  private overrun(): never {
    throw new CramBufferOverrunError(
      'attempted to read beyond the end of the buffer. this file seems truncated.',
    )
  }

  private require(bytes: number) {
    if (this.bytePosition + bytes > this.buffer.length) {
      this.overrun()
    }
  }

  itf8() {
    // ITF8 takes its width from the first byte, so the cheap check is after the
    // fact: an over-read lands the cursor past the end whatever width it picked
    const value = parseItf8(this.buffer, this)
    if (this.bytePosition > this.buffer.length) {
      this.overrun()
    }
    return value
  }

  ltf8() {
    const value = parseLtf8(this.buffer, this)
    if (this.bytePosition > this.buffer.length) {
      this.overrun()
    }
    return value
  }

  u8() {
    this.require(1)
    return this.buffer[this.bytePosition++]!
  }

  /** a one-byte boolean, as the preservation map stores its flags */
  bool() {
    return !!this.u8()
  }

  u32() {
    return this.i32() >>> 0
  }

  i32() {
    this.require(4)
    const b = this.buffer
    const o = this.bytePosition
    this.bytePosition = o + 4
    return b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)
  }

  /** `length` raw bytes as a view into the underlying buffer; nothing is copied */
  bytes(length: number) {
    this.require(length)
    const start = this.bytePosition
    this.bytePosition = start + length
    return this.buffer.subarray(start, start + length)
  }

  /** `length` bytes as ASCII, for the short fixed-width keys the maps use */
  ascii(length: number) {
    this.require(length)
    const b = this.buffer
    let s = ''
    for (let i = 0; i < length; i++) {
      s += String.fromCharCode(b[this.bytePosition + i]!)
    }
    this.bytePosition += length
    return s
  }
}
