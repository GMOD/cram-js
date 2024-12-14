/*
 * Copyright (c) 2019,2020 Genome Research Ltd.
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

import bzip2 from 'bzip2'

import RangeCoder from './arith_sh'
import ByteModel from './byte_model'
import IOStream from './iostream'

function sum(array) {
  let sum = 0
  for (const entry of array) {
    sum += entry.length
  }
  return sum
}
function concatUint8Array(args) {
  const mergedArray = new Uint8Array(sum(args))
  let offset = 0
  for (const entry of args) {
    mergedArray.set(entry, offset)
    offset += entry.length
  }
  return mergedArray
}

const ARITH_ORDER = 1
const ARITH_EXT = 4
const ARITH_STRIPE = 8
const ARITH_NOSIZE = 16
const ARITH_CAT = 32
const ARITH_RLE = 64
const ARITH_PACK = 128

export default class RangeCoderGen {
  decode(src) {
    this.stream = new IOStream(src)
    return this.decodeStream(this.stream)
  }

  decodeStream(stream, n_out = 0) {
    const flags = this.stream.ReadByte()
    if (!(flags & ARITH_NOSIZE)) {
      n_out = this.stream.ReadUint7()
    }
    let e_len = n_out

    const order = flags & ARITH_ORDER

    // 4-way recursion
    if (flags & ARITH_STRIPE) {
      return this.decodeStripe(this.stream, n_out)
    }

    // Meta data
    if (flags & ARITH_PACK) {
      var P
      ;[P, e_len] = this.decodePackMeta(this.stream)
    }

    // NOP, useful for tiny blocks
    if (flags & ARITH_CAT) {
      var data = this.decodeCat(this.stream, e_len)
    }
    // Entropy decode
    else if (flags & ARITH_EXT) {
      var data = this.decodeExt(this.stream, e_len)
    } else if (flags & ARITH_RLE) {
      var data = order
        ? this.decodeRLE1(this.stream, e_len)
        : this.decodeRLE0(this.stream, e_len)
    } else {
      var data = order
        ? this.decode1(this.stream, e_len)
        : this.decode0(this.stream, e_len)
    }

    // Transforms
    if (flags & ARITH_PACK) {
      data = this.decodePack(data, P, n_out)
    }

    return data
  }

  // ----------------------------------------------------------------------
  // Order-0 codec
  decode0(stream, n_out) {
    const output = new Uint8Array(n_out)

    let max_sym = stream.ReadByte()
    if (max_sym == 0) {
      max_sym = 256
    }

    const byte_model = new ByteModel(max_sym)

    const rc = new RangeCoder(stream)
    rc.RangeStartDecode(stream)

    for (let i = 0; i < n_out; i++) {
      output[i] = byte_model.ModelDecode(stream, rc)
    }

    return output
  }

  // ----------------------------------------------------------------------
  // Order-1 codec

  decode1(stream, n_out) {
    const output = new Uint8Array(n_out)

    let max_sym = stream.ReadByte()
    if (max_sym == 0) {
      max_sym = 256
    }

    const byte_model = new Array(max_sym)
    for (var i = 0; i < max_sym; i++) {
      byte_model[i] = new ByteModel(max_sym)
    }

    const rc = new RangeCoder(stream)
    rc.RangeStartDecode(stream)

    let last = 0
    for (var i = 0; i < n_out; i++) {
      output[i] = byte_model[last].ModelDecode(stream, rc)
      last = output[i]
    }

    return output
  }

  // ----------------------------------------------------------------------
  // External codec
  decodeExt(stream, n_out) {
    const bits = bzip2.array(stream.buf.slice(stream.pos))
    let size = bzip2.header(bits)
    let chunk
    const chunks = []
    do {
      chunk = bzip2.decompress(bits, size)
      if (chunk !== -1) {
        chunks.push(chunk)
        size -= chunk.length
      }
    } while (chunk !== -1)
    return concatUint8Array(chunks)
  }

  // ----------------------------------------------------------------------
  // Order-0 RLE codec
  decodeRLE0(stream, n_out) {
    const output = new Uint8Array(n_out)

    let max_sym = stream.ReadByte()
    if (max_sym == 0) {
      max_sym = 256
    }

    const model_lit = new ByteModel(max_sym)
    const model_run = new Array(258)
    for (var i = 0; i <= 257; i++) {
      model_run[i] = new ByteModel(4)
    }

    const rc = new RangeCoder(stream)
    rc.RangeStartDecode(stream)

    var i = 0
    while (i < n_out) {
      output[i] = model_lit.ModelDecode(stream, rc)
      let part = model_run[output[i]].ModelDecode(stream, rc)
      let run = part
      let rctx = 256
      while (part == 3) {
        part = model_run[rctx].ModelDecode(stream, rc)
        rctx = 257
        run += part
      }
      for (let j = 1; j <= run; j++) {
        output[i + j] = output[i]
      }
      i += run + 1
    }

    return output
  }

  // ----------------------------------------------------------------------
  // Order-1 RLE codec

  decodeRLE1(stream, n_out) {
    const output = new Uint8Array(n_out)

    let max_sym = stream.ReadByte()
    if (max_sym == 0) {
      max_sym = 256
    }

    const model_lit = new Array(max_sym)
    for (var i = 0; i < max_sym; i++) {
      model_lit[i] = new ByteModel(max_sym)
    }

    const model_run = new Array(258)
    for (var i = 0; i <= 257; i++) {
      model_run[i] = new ByteModel(4)
    }

    const rc = new RangeCoder(stream)
    rc.RangeStartDecode(stream)

    let last = 0
    var i = 0
    while (i < n_out) {
      output[i] = model_lit[last].ModelDecode(stream, rc)
      last = output[i]
      let part = model_run[output[i]].ModelDecode(stream, rc)
      let run = part
      let rctx = 256
      while (part == 3) {
        part = model_run[rctx].ModelDecode(stream, rc)
        rctx = 257
        run += part
      }
      for (let j = 1; j <= run; j++) {
        output[i + j] = output[i]
      }
      i += run + 1
    }

    return output
  }

  // ----------------------------------------------------------------------
  // Pack method
  decodePackMeta(stream) {
    this.nsym = stream.ReadByte()

    const M = new Array(this.nsym)
    for (let i = 0; i < this.nsym; i++) {
      M[i] = stream.ReadByte()
    }

    const e_len = stream.ReadUint7() // Could be derived data from nsym and n_out

    return [M, e_len]
  }

  decodePack(data, M, len) {
    const out = new Uint8Array(len)

    if (this.nsym <= 1) {
      // Constant value
      for (var i = 0; i < len; i++) {
        out[i] = M[0]
      }
    } else if (this.nsym <= 2) {
      // 1 bit per value
      for (var i = 0, j = 0; i < len; i++) {
        if (i % 8 == 0) {
          var v = data[j++]
        }
        out[i] = M[v & 1]
        v >>= 1
      }
    } else if (this.nsym <= 4) {
      // 2 bits per value
      for (var i = 0, j = 0; i < len; i++) {
        if (i % 4 == 0) {
          var v = data[j++]
        }
        out[i] = M[v & 3]
        v >>= 2
      }
    } else if (this.nsym <= 16) {
      // 4 bits per value
      for (var i = 0, j = 0; i < len; i++) {
        if (i % 2 == 0) {
          var v = data[j++]
        }
        out[i] = M[v & 15]
        v >>= 4
      }
    } else {
      // 8 bits per value: NOP
      return data
    }

    return out
  }

  // Compute M array and return meta-data stream
  packMeta(src) {
    const stream = new IOStream('', 0, 1024)

    // Count symbols
    const M = new Array(256)
    for (var i = 0; i < src.length; i++) {
      M[src[i]] = 1
    }

    // Write Map
    for (var nsym = 0, i = 0; i < 256; i++) {
      if (M[i]) {
        M[i] = ++nsym
      }
    } // map to 1..N
    stream.WriteByte(nsym)

    // FIXME: add check for nsym > 16?
    // Or just accept it as an inefficient waste of time.
    for (var i = 0; i < 256; i++) {
      if (M[i]) {
        stream.WriteByte(i) // adjust to 0..N-1
        M[i]--
      }
    }

    return [stream, M, nsym]
  }

  decodeStripe(stream, len) {
    const N = stream.ReadByte()

    // Retrieve lengths
    const clen = new Array(N)
    const ulen = new Array(N)
    for (var j = 0; j < N; j++) {
      clen[j] = stream.ReadUint7()
    }

    // Decode streams
    const T = new Array(N)
    for (var j = 0; j < N; j++) {
      ulen[j] = Math.floor(len / N) + (len % N > j)
      T[j] = this.decodeStream(stream, ulen[j])
    }

    // Transpose
    const out = new Uint8Array(len)
    for (var j = 0; j < N; j++) {
      for (let i = 0; i < ulen[j]; i++) {
        out[i * N + j] = T[j][i]
      }
    }

    return out
  }

  // ----------------------------------------------------------------------
  // Cat method
  decodeCat(stream, len) {
    const out = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      out[i] = stream.ReadByte()
    }

    return out
  }
}
