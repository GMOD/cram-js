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

import IOStream from './iostream'

// ----------------------------------------------------------------------
// rANS primitives itself
//
// RansGet* is decoder side

function RansGetCumulativeFreq(R, bits) {
  return R & ((1 << bits) - 1)
}

function RansGetSymbolFromFreq(C, f) {
  // NOTE: Inefficient.
  // In practice we would implement this via a precomputed
  // lookup table C2S[f]; see RansBuildC2S below.
  let s = 0
  while (f >= C[s + 1]) {
    s++
  }

  // console.error(f, C, s)

  return s
}

function RansBuildC2S(C, bits) {
  const max = 1 << bits
  const C2S = new Array(max)
  let s = 0
  for (let f = 0; f < max; f++) {
    while (f >= C[s + 1]) {
      s++
    }
    C2S[f] = s
  }
  return C2S
}

function RansAdvanceStep(R, c, f, bits) {
  return f * (R >> bits) + (R & ((1 << bits) - 1)) - c
}

function RansRenorm(src, R) {
  if (R < 1 << 15) {
    R = (R << 16) + src.ReadUint16()
  }

  return R
}

function DecodeRLEMeta(src, N) {
  const u_meta_len = src.ReadUint7()
  const rle_len = src.ReadUint7()

  // Decode RLE lengths
  if (u_meta_len & 1) {
    var rle_meta = src.ReadData((u_meta_len - 1) / 2)
  } else {
    const comp_meta_len = src.ReadUint7()
    var rle_meta = src.ReadData(comp_meta_len)
    rle_meta = RansDecode0(new IOStream(rle_meta), u_meta_len / 2, N)
  }

  // Decode list of symbols for which RLE lengths are applied
  var rle_meta = new IOStream(rle_meta)
  const L = new Array(256)
  let n = rle_meta.ReadByte()
  if (n == 0) {
    n = 256
  }
  for (let i = 0; i < n; i++) {
    L[rle_meta.ReadByte()] = 1
  }

  return [L, rle_meta, rle_len]
}

function DecodeRLE(buf, L, rle_meta, len) {
  const src = new IOStream(buf)

  const out = new Uint8Array(len)

  // Expand up buf+meta to out; i = buf index, j = out index
  let j = 0
  for (let i = 0; j < len; i++) {
    const sym = buf[i]
    if (L[sym]) {
      const run = rle_meta.ReadUint7()
      for (let r = 0; r <= run; r++) {
        out[j++] = sym
      }
    } else {
      out[j++] = sym
    }
  }

  return out
}

// Pack meta data is the number and value of distinct symbols plus
// the length of the packed byte stream.
function DecodePackMeta(src) {
  const nsym = src.ReadByte()
  const P = new Array(nsym)

  for (let i = 0; i < nsym; i++) {
    P[i] = src.ReadByte()
  }

  const len = src.ReadUint7()

  return [P, nsym, len]
}

// Extract bits from src producing output of length len.
// Nsym is number of distinct symbols used.
function DecodePack(data, P, nsym, len) {
  const out = new Uint8Array(len)
  let j = 0

  // Constant value
  if (nsym <= 1) {
    for (var i = 0; i < len; i++) {
      out[i] = P[0]
    }
  }

  // 1 bit per value
  else if (nsym <= 2) {
    for (i = 0; i < len; i++) {
      if (i % 8 == 0) {
        var v = data[j++]
      }

      out[i] = P[v & 1]
      v >>= 1
    }
  }

  // 2 bits per value
  else if (nsym <= 4) {
    for (i = 0; i < len; i++) {
      if (i % 4 == 0) {
        var v = data[j++]
      }

      out[i] = P[v & 3]
      v >>= 2
    }
  }

  // 4 bits per value
  else if (nsym <= 16) {
    for (i = 0; i < len; i++) {
      if (i % 2 == 0) {
        var v = data[j++]
      }

      out[i] = P[v & 15]
      v >>= 4
    }
  }

  return out
}

function RansDecodeStripe(src, len) {
  const N = src.ReadByte()

  // Retrieve lengths
  const clen = new Array(N)
  const ulen = new Array(N)
  for (var j = 0; j < N; j++) {
    clen[j] = src.ReadUint7()
  }

  // Decode streams
  const T = new Array(N)
  for (var j = 0; j < N; j++) {
    ulen[j] = Math.floor(len / N) + (len % N > j)
    T[j] = RansDecodeStream(src, ulen[j])
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
// Main rANS entry function: decodes a compressed src and
// returns the uncompressed buffer.
export function decode(src) {
  const stream = new IOStream(src)
  return RansDecodeStream(stream, 0)
}

function RansDecodeStream(stream, n_out) {
  const format = stream.ReadByte()
  const order = format & 1
  const x32 = format & 4
  const stripe = format & 8
  const nosz = format & 16
  const cat = format & 32
  const rle = format & 64
  const pack = format & 128

  const Nway = x32 ? 32 : 4

  if (!nosz) {
    n_out = stream.ReadUint7()
  }

  // N-way interleaving
  if (stripe) {
    return RansDecodeStripe(stream, n_out)
  }

  // Bit packing
  if (pack) {
    var pack_len = n_out
    var [P, nsym, n_out] = DecodePackMeta(stream)
  }

  // Run length encoding
  if (rle) {
    var rle_len = n_out
    var [L, rle_meta, n_out] = DecodeRLEMeta(stream, Nway)
  }

  // Uncompress data (all, packed or run literals)
  if (cat) {
    var buf = stream.ReadData(n_out)
  } else if (order == 0) {
    var buf = RansDecode0(stream, n_out, Nway)
  } else {
    var buf = RansDecode1(stream, n_out, Nway)
  }

  // Apply expansion transforms
  if (rle) {
    buf = DecodeRLE(buf, L, rle_meta, rle_len)
  }

  if (pack) {
    buf = DecodePack(buf, P, nsym, pack_len)
  }

  return buf
}

// ----------------------------------------------------------------------
// Order-0 decoder

function ReadAlphabet(src) {
  const A = new Array(256)
  for (let i = 0; i < 256; i++) {
    A[i] = 0
  }

  let rle = 0
  let sym = src.ReadByte()
  let last_sym = sym

  do {
    A[sym] = 1
    if (rle > 0) {
      rle--
      sym++
    } else {
      sym = src.ReadByte()
      if (sym == last_sym + 1) {
        rle = src.ReadByte()
      }
    }
    last_sym = sym
  } while (sym != 0)

  return A
}

// Decode a single table of order-0 frequences,
// filling out the F and C arrays.
function ReadFrequencies0(src, F, C) {
  // Initialise; not in the specification - implicit?
  for (var i = 0; i < 256; i++) {
    F[i] = 0
  }

  // Fetch alphabet
  const A = ReadAlphabet(src)

  // Fetch frequencies for the symbols listed in our alphabet
  for (var i = 0; i < 256; i++) {
    if (A[i] > 0) {
      F[i] = src.ReadUint7()
    }
  }

  NormaliseFrequencies0_Shift(F, 12)

  // Compute C[] from F[]
  C[0] = 0
  for (var i = 0; i <= 255; i++) {
    C[i + 1] = C[i] + F[i]
  }
}

function RansDecode0(src, nbytes, N) {
  // Decode frequencies
  const F = new Array(256)
  const C = new Array(256)
  ReadFrequencies0(src, F, C)

  // Fast lookup to avoid slow RansGetSymbolFromFreq
  const C2S = RansBuildC2S(C, 12)

  // Initialise rANS state
  const R = new Array(N)
  for (var i = 0; i < N; i++) {
    R[i] = src.ReadUint32()
  }

  // Main decode loop
  const output = new Uint8Array(nbytes)
  for (var i = 0; i < nbytes; i++) {
    const ix = i & (N - 1) // equiv to i%N as N is power of 2
    const f = RansGetCumulativeFreq(R[ix], 12)
    const s = C2S[f] // Equiv to RansGetSymbolFromFreq(C, f);

    output[i] = s
    R[ix] = RansAdvanceStep(R[ix], C[s], F[s], 12)
    R[ix] = RansRenorm(src, R[ix])
  }

  // Main decode loop
  return output
}

function NormaliseFrequencies0_Shift(F, bits) {
  // Compute total and number of bits to shift by
  let tot = 0
  for (var i = 0; i < 256; i++) {
    tot += F[i]
  }

  if (tot == 0 || tot == 1 << bits) {
    return
  }

  let shift = 0
  while (tot < 1 << bits) {
    tot *= 2
    shift++
  }

  // Scale total of frequencies to (1<<bits)
  for (var i = 0; i < 256; i++) {
    F[i] <<= shift
  }
}
// ----------------------------------------------------------------------
// Order-1 decoder

// Decode a table of order-1 frequences,
// filling out the F and C arrays.
function ReadFrequencies1(src, F, C, shift) {
  // Initialise; not in the specification - implicit?
  for (var i = 0; i < 256; i++) {
    F[i] = new Array(256)
    C[i] = new Array(256)
    for (var j = 0; j < 256; j++) {
      F[i][j] = 0
    }
  }

  // Fetch alphabet
  const A = ReadAlphabet(src)

  // Read F[]
  for (var i = 0; i < 256; i++) {
    if (!A[i]) {
      continue
    }

    let run = 0
    for (var j = 0; j < 256; j++) {
      if (!A[j]) {
        continue
      }

      if (run > 0) {
        run--
      } else {
        F[i][j] = src.ReadUint7()
        if (F[i][j] == 0) {
          run = src.ReadByte()
        }
      }
    }

    NormaliseFrequencies0_Shift(F[i], shift)

    // Compute C[] from F[]
    C[i][0] = 0
    for (var j = 0; j < 256; j++) {
      C[i][j + 1] = C[i][j] + F[i][j]
    }
  }
}

function RansDecode1(src, nbytes, N) {
  // FIXME: this bit is missing from the RansDecode0 pseudocode.

  var comp = src.ReadByte()
  const shift = comp >> 4

  var freq_src = src
  if (comp & 1) {
    const ulen = src.ReadUint7()
    const clen = src.ReadUint7()
    var comp = new IOStream(src.ReadData(clen))
    var freq_src = new IOStream(RansDecode0(comp, ulen, 4))
  }

  // Decode frequencies
  const F = new Array(256)
  const C = new Array(256)
  ReadFrequencies1(freq_src, F, C, shift)

  // Fast lookup to avoid slow RansGetSymbolFromFreq
  const C2S = new Array(256)
  for (var i = 0; i < 256; i++) // Could do only for symbols in alphabet?
  {
    C2S[i] = RansBuildC2S(C[i], shift)
  }

  // Initialise rANS state
  const R = new Array(N)
  const L = new Array(N)
  for (var j = 0; j < N; j++) {
    R[j] = src.ReadUint32()
    L[j] = 0
  }

  // Main decode loop
  const output = new Uint8Array(nbytes)
  const nbytesx = Math.floor(nbytes / N)
  for (var i = 0; i < nbytesx; i++) {
    for (var j = 0; j < N; j++) {
      var f = RansGetCumulativeFreq(R[j], shift)

      // var s = RansGetSymbolFromFreq(C[L[j]], f);
      var s = C2S[L[j]][f] // Precomputed version of above

      output[i + j * nbytesx] = s
      R[j] = RansAdvanceStep(R[j], C[L[j]][s], F[L[j]][s], shift)
      R[j] = RansRenorm(src, R[j])
      L[j] = s
    }
  }

  // Now deal with the remainder if buffer size is not a multiple of N,
  // using the last rANS state exclusively.  (It'd have been nice to have
  // designed this to just act as if we kept going with a bail out.)
  i = N * i
  while (i < nbytes) {
    var f = RansGetCumulativeFreq(R[N - 1], shift)
    var s = RansGetSymbolFromFreq(C[L[N - 1]], f)
    output[i++] = s
    R[N - 1] = RansAdvanceStep(R[N - 1], C[L[N - 1]][s], F[L[N - 1]][s], shift)
    R[N - 1] = RansRenorm(src, R[N - 1])
    L[N - 1] = s
  }

  return output
}
