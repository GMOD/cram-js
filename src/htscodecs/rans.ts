/*
 * Copyright (c) 2019-2020 Genome Research Ltd.
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

function RansGetCumulativeFreq(R) {
  return R & 0xfff
}

function RansGetSymbolFromFreq(C, f) {
  // NOTE: Inefficient.
  // In practice we would implement this via a precomputed
  // lookup table C2S[f]; see RansBuildC2S below.
  let s = 0
  while (f >= C[s + 1]) {
    s++
  }

  return s
}

function RansBuildC2S(C) {
  const C2S = new Array(0x1000)
  let s = 0
  for (let f = 0; f < 0x1000; f++) {
    while (f >= C[s + 1]) {
      s++
    }
    C2S[f] = s
  }
  return C2S
}

function RansAdvanceStep(R, c, f) {
  return f * (R >> 12) + (R & 0xfff) - c
}

function RansRenorm(src, R) {
  while (R < 1 << 23) {
    R = (R << 8) + src.ReadByte()
  }

  return R
}
// ----------------------------------------------------------------------
// Main rANS entry function: decodes a compressed src and
// returns the uncompressed buffer.
function decode(src) {
  const stream = new IOStream(src)
  const order = stream.ReadByte()
  const n_in = stream.ReadUint32()
  const n_out = stream.ReadUint32()

  return order == 0 ? RansDecode0(stream, n_out) : RansDecode1(stream, n_out)
}

// ----------------------------------------------------------------------
// Order-0 decoder

// Decode a single table of order-0 frequences,
// filling out the F and C arrays.
function ReadFrequencies0(src, F, C) {
  // Initialise; not in the specification - implicit?
  for (var i = 0; i < 256; i++) {
    F[i] = 0
  }

  let sym = src.ReadByte()
  let last_sym = sym
  let rle = 0

  // Read F[]
  do {
    const f = src.ReadITF8()
    F[sym] = f
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

  // Compute C[] from F[]
  C[0] = 0
  for (var i = 0; i <= 255; i++) {
    C[i + 1] = C[i] + F[i]
  }
}

function RansDecode0(src, nbytes) {
  // Decode frequencies
  const F = new Array(256)
  const C = new Array(256)
  ReadFrequencies0(src, F, C)

  // Fast lookup to avoid slow RansGetSymbolFromFreq
  const C2S = RansBuildC2S(C)

  // Initialise rANS state
  const R = new Array(4)
  for (var i = 0; i < 4; i++) {
    R[i] = src.ReadUint32()
  }

  // Main decode loop
  const output = new Uint8Array(nbytes)
  for (var i = 0; i < nbytes; i++) {
    const i4 = i % 4
    const f = RansGetCumulativeFreq(R[i4])
    const s = C2S[f] // Equiv to RansGetSymbolFromFreq(C, f);

    output[i] = s
    R[i4] = RansAdvanceStep(R[i4], C[s], F[s])
    R[i4] = RansRenorm(src, R[i4])
  }

  return output
}

// ----------------------------------------------------------------------
// Order-1 decoder

// Decode a table of order-1 frequences,
// filling out the F and C arrays.
function ReadFrequencies1(src, F, C) {
  // Initialise; not in the specification - implicit?
  for (let i = 0; i < 256; i++) {
    F[i] = new Array(256)
    C[i] = new Array(256)
    for (let j = 0; j < 256; j++) {
      F[i][j] = 0
    }
  }

  let sym = src.ReadByte()
  let last_sym = sym
  let rle = 0

  // Read F[]
  do {
    ReadFrequencies0(src, F[sym], C[sym])

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
}

function RansDecode1(src, nbytes) {
  // Decode frequencies
  const F = new Array(256)
  const C = new Array(256)
  ReadFrequencies1(src, F, C)

  // Fast lookup to avoid slow RansGetSymbolFromFreq
  const C2S = new Array(256)
  for (var i = 0; i < 256; i++) {
    C2S[i] = RansBuildC2S(C[i])
  }

  // Initialise rANS state
  const R = new Array(4)
  const L = new Array(4)
  for (var j = 0; j < 4; j++) {
    R[j] = src.ReadUint32()
    L[j] = 0
  }

  // Main decode loop
  const output = new Uint8Array(nbytes)
  const nbytes4 = Math.floor(nbytes / 4)
  for (var i = 0; i < nbytes4; i++) {
    for (var j = 0; j < 4; j++) {
      var f = RansGetCumulativeFreq(R[j])

      // var s = RansGetSymbolFromFreq(C[L[j]], f);
      var s = C2S[L[j]][f] // Precomputed version of above

      output[i + j * nbytes4] = s
      R[j] = RansAdvanceStep(R[j], C[L[j]][s], F[L[j]][s])
      R[j] = RansRenorm(src, R[j])
      L[j] = s
    }
  }

  // Now deal with the remainder if buffer size is not a multiple of 4,
  // using rANS state 3 exclusively.  (It'd have been nice to have
  // designed this to just act as if we kept going with a bail out.)
  i = 4 * i
  while (i < nbytes) {
    var f = RansGetCumulativeFreq(R[3])
    var s = RansGetSymbolFromFreq(C[L[3]], f)
    output[i++] = s
    R[3] = RansAdvanceStep(R[3], C[L[3]][s], F[L[3]][s])
    R[3] = RansRenorm(src, R[3])
    L[3] = s
  }

  return output
}

module.exports = { decode }
