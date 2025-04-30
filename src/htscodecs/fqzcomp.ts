/* eslint-disable no-var */
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

import RangeCoder from './arith_sh.ts'
import ByteModel from './byte_model.ts'
import IOStream from './iostream.ts'

// ----------------------------------------------------------------------
// Main arithmetic entry function: decodes a compressed src and
// returns the uncompressed buffer.

function read_array(src, tab, size) {
  let j = 0 // array value
  let z = 0 // array index: tab[j]
  let last = -1

  // Remove first level of run-length encoding
  const R = new Array(1024) // runs
  while (z < size) {
    const run = src.ReadByte()
    R[j++] = run
    z += run

    if (run == last) {
      let copy = src.ReadByte()
      z += run * copy
      while (copy--) {
        R[j++] = run
      }
    }
    last = run
  }

  // Now expand runs in R to tab, noting 255 is max run
  let i = 0
  j = 0
  z = 0
  while (z < size) {
    let run_len = 0
    do {
      var part = R[j++]
      run_len += part
    } while (part == 255)

    while (run_len--) {
      tab[z++] = i
    }
    i++
  }
}

const QMAX = 256

const FLAG_DEDUP = 2
const FLAG_FLEN = 4
const FLAG_SEL = 8 // whether selector is used in context
const FLAG_QMAP = 16
const FLAG_PTAB = 32
const FLAG_DTAB = 64
const FLAG_QTAB = 128

const GFLAG_MULTI_PARAM = 1
const GFLAG_HAVE_STAB = 2
const GFLAG_DO_REV = 4

// Compute a new context from our current state and qual q
function fqz_update_ctx(params, state, q) {
  let last = params.context
  state.qctx = (state.qctx << params.qshift) + params.qtab[q] // >>> 0
  last += (state.qctx & ((1 << params.qbits) - 1)) << params.qloc // >>> 0

  if (params.do_pos) {
    last += params.ptab[Math.min(state.p, 1023)] << params.ploc
  }

  if (params.do_delta) {
    last += params.dtab[Math.min(state.delta, 255)] << params.dloc
    // Is it better to use q here or qtab[q]?
    // If qtab[q] we can map eg [a-z0-9A-Z]->0 ,->1 and have
    // delta being a token number count into comma separated lists?
    state.delta += state.prevq != q ? 1 : 0
    state.prevq = q
  }

  if (params.do_sel) {
    last += state.s << params.sloc
  }

  state.p--

  return last & 0xffff
}

function decode_fqz_single_param(src) {
  const p = {} // params

  // Load FQZ parameters
  p.context = src.ReadUint16()
  p.pflags = src.ReadByte()

  p.do_dedup = p.pflags & FLAG_DEDUP
  p.fixed_len = p.pflags & FLAG_FLEN
  p.do_sel = p.pflags & FLAG_SEL
  p.do_qmap = p.pflags & FLAG_QMAP
  p.do_pos = p.pflags & FLAG_PTAB
  p.do_delta = p.pflags & FLAG_DTAB
  p.do_qtab = p.pflags & FLAG_QTAB

  p.max_sym = src.ReadByte()

  let x = src.ReadByte()
  p.qbits = x >> 4
  p.qshift = x & 15
  x = src.ReadByte()
  p.qloc = x >> 4
  p.sloc = x & 15
  x = src.ReadByte()
  p.ploc = x >> 4
  p.dloc = x & 15

  // Qual map, eg to "unbin" Illumina qualities
  p.qmap = new Array(256)
  if (p.pflags & FLAG_QMAP) {
    for (var i = 0; i < p.max_sym; i++) {
      p.qmap[i] = src.ReadByte()
    }
  } else {
    // Useful optimisation to speed up main loop
    for (var i = 0; i < 256; i++) {
      p.qmap[i] = i
    } // NOP
  }

  // Read tables
  p.qtab = new Array(1024)
  if (p.qbits > 0 && p.pflags & FLAG_QTAB) {
    read_array(src, p.qtab, 256)
  } else {
    // Useful optimisation to speed up main loop
    for (var i = 0; i < 256; i++) {
      p.qtab[i] = i
    } // NOP
  }

  p.ptab = new Array(1024)
  if (p.pflags & FLAG_PTAB) {
    read_array(src, p.ptab, 1024)
  }

  p.dtab = new Array(256)
  if (p.pflags & FLAG_DTAB) {
    read_array(src, p.dtab, 256)
  }

  return p
}

function decode_fqz_params(src) {
  const gparams = {
    max_sym: 0,
  }

  // Check fqz format version
  const vers = src.ReadByte()
  if (vers != 5) {
    console.error('Invalid FQZComp version number')
    return
  }

  const gflags = src.ReadByte()
  const nparam = gflags & GFLAG_MULTI_PARAM ? src.ReadByte() : 1
  let max_sel = gflags.nparam > 1 ? gflags.nparam - 1 : 0 // Note max_sel, not num_sel

  const stab = new Array(256)
  if (gflags & GFLAG_HAVE_STAB) {
    max_sel = src.ReadByte()
    read_array(src, stab, 256)
  } else {
    for (var i = 0; i < nparam; i++) {
      stab[i] = i
    }
    for (; i < 256; i++) {
      stab[i] = nparam - 1
    }
  }
  gparams.do_rev = gflags & GFLAG_DO_REV
  gparams.stab = stab
  gparams.max_sel = max_sel

  gparams.params = new Array(gparams.nparam)
  for (let p = 0; p < nparam; p++) {
    gparams.params[p] = decode_fqz_single_param(src)
    if (gparams.max_sym < gparams.params[p].max_sym) {
      gparams.max_sym = gparams.params[p].max_sym
    }
  }

  return gparams
}

function fqz_create_models(gparams) {
  const model = {}

  model.qual = new Array(1 << 16)
  for (var i = 0; i < 1 << 16; i++) {
    model.qual[i] = new ByteModel(gparams.max_sym + 1)
  } // +1 as max value not num. values

  model.len = new Array(4)
  for (var i = 0; i < 4; i++) {
    model.len[i] = new ByteModel(256)
  }

  model.rev = new ByteModel(2)
  model.dup = new ByteModel(2)

  if (gparams.max_sel > 0) {
    model.sel = new ByteModel(gparams.max_sel + 1)
  } // +1 as max value not num. values

  return model
}

// Initialise a new record, updating state.
// Returns 1 if dup, otherwise 0
function decode_fqz_new_record(src, rc, gparams, model, state, rev) {
  // Parameter selector
  state.s = gparams.max_sel > 0 ? model.sel.ModelDecode(src, rc) : 0
  state.x = gparams.stab[state.s]

  const params = gparams.params[state.x]

  // Reset contexts at the start of each new record
  if (params.fixed_len >= 0) {
    // Not fixed or fixed but first record
    var len = model.len[0].ModelDecode(src, rc)
    len |= model.len[1].ModelDecode(src, rc) << 8
    len |= model.len[2].ModelDecode(src, rc) << 16
    len |= model.len[3].ModelDecode(src, rc) << 24
    if (params.fixed_len > 0) {
      params.fixed_len = -len
    }
  } else {
    len = -params.fixed_len
  }
  state.len = len

  if (gparams.do_rev) {
    rev[state.rec] = model.rev.ModelDecode(src, rc)
  }

  state.is_dup = 0
  if (params.pflags & FLAG_DEDUP) {
    if (model.dup.ModelDecode(src, rc)) {
      state.is_dup = 1
    }
  }

  state.p = len // number of remaining bytes in this record
  state.delta = 0
  state.qctx = 0
  state.prevq = 0
  state.rec++
}

function decode_fqz(src: IOStream, q_lens: number) {
  // Decode parameter block
  const n_out = src.ReadUint7()
  const gparams = decode_fqz_params(src)
  if (!gparams) {
    return
  }
  var params = gparams.params
  const rev = new Array(q_lens.length)

  // Create initial models
  const model = fqz_create_models(gparams)

  // Create our entropy encoder and output buffers
  const rc = new RangeCoder(src)
  rc.RangeStartDecode(src)
  const output = new Uint8Array(n_out)

  // Internal FQZ state
  const state = {
    qctx: 0, // Qual-only sub-context
    prevq: 0, // Previous quality value
    delta: 0, // Running delta (q vs prevq)
    p: 0, // Number of bases left in current record
    s: 0, // Current parameter selector value (0 if unused)
    x: 0, // "stab" tabulated copy of s
    len: 0, // Length of current string
    is_dup: 0, // This string is a duplicate of last
    rec: 0, // Record number
  }

  // The main decode loop itself
  let i = 0 // position in output buffer
  while (i < n_out) {
    if (state.p == 0) {
      decode_fqz_new_record(src, rc, gparams, model, state, rev)
      if (state.is_dup > 0) {
        if (model.dup.ModelDecode(src, rc)) {
          // Duplicate of last line
          for (let x = 0; x < len; x++) {
            output[i + x] = output[i + x - state.len]
          }
          i += state.len
          state.p = 0
          continue
        }
      }
      q_lens.push(state.len)

      var params = gparams.params[state.x]
      var last = params.context
    }

    // Decode the current quality (possibly mapped via qmap)
    const Q = model.qual[last].ModelDecode(src, rc)

    // if (params.do_qmap)
    //    output[i++] = params.qmap[Q];
    // else
    //    output[i++] = Q
    output[i++] = params.qmap[Q] // optimised version of above
    last = fqz_update_ctx(params, state, Q)
  }

  if (gparams.do_rev) {
    reverse_qualities(output, n_out, rev, q_lens)
  }

  return output
}

function reverse_qualities(qual, qual_len, rev, len) {
  let rec = 0
  let i = 0
  while (i < qual_len) {
    if (rev[rec]) {
      let j = 0
      let k = len[rec] - 1
      while (j < k) {
        const tmp = qual[i + j]
        qual[i + j] = qual[i + k]
        qual[i + k] = tmp
        j++
        k--
      }
    }

    i += len[rec++]
  }
}

export function decode(src: Uint8Array, q_lens) {
  const stream = new IOStream(src)

  return decode_fqz(stream, q_lens)
}
