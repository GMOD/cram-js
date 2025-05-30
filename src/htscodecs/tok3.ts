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

// Name tokeniser
//
// This is a reference implementation designed to match the
// written specification as closely as possible.  It is *NOT*
// an efficient implementation, but see comments below.

import { concatUint8Array } from '../util.ts'
import arith_gen from './arith_gen.ts'
import IOStream from './iostream.ts'
import * as rans from './rans4x16.ts'

const arith = new arith_gen()

const TOK_TYPE = 0
const TOK_STRING = 1
const TOK_CHAR = 2
const TOK_DIGITS0 = 3
const TOK_DZLEN = 4
const TOK_DUP = 5
const TOK_DIFF = 6
const TOK_DIGITS = 7
const TOK_DELTA = 8
const TOK_DELTA0 = 9
const TOK_MATCH = 10
const TOK_NOP = 11
const TOK_END = 12

// ----------------------------------------------------------------------
// Token byte streams
function DecodeTokenByteStreams(src, in_size, use_arith, nnames) {
  let t = -1

  const B = new Array(256)

  while (!src.EOF()) {
    const ttype = src.ReadByte()
    const tok_new = ttype & 128
    const tok_dup = ttype & 64
    const type = ttype & 63

    if (tok_new) {
      t++
      B[t] = new Array(13)
    }

    if (type != TOK_TYPE && tok_new) {
      const M = new Array(nnames - 1).fill(TOK_MATCH)
      B[t][TOK_TYPE] = new IOStream(concatUint8Array([new Uint8Array(type), M]))
    }

    if (tok_dup) {
      const dup_pos = src.ReadByte()
      const dup_type = src.ReadByte()
      B[t][type] = new IOStream(B[dup_pos][dup_type].buf)
    } else {
      const clen = src.ReadUint7()
      const data = src.ReadData(clen)

      B[t][type] = use_arith ? arith.decode(data) : rans.decode(data)
      B[t][type] = new IOStream(B[t][type])
    }
  }

  return B
}

// ----------------------------------------------------------------------
// Token decode
function LeftPadNumber(val, len) {
  let str = val + ''
  while (str.length < len) {
    str = '0' + str
  }

  return str
}

function DecodeSingleName(B, N, T, n) {
  let type = B[0][TOK_TYPE].ReadByte()
  const dist = B[0][type].ReadUint32()
  const m = n - dist

  if (type == TOK_DUP) {
    N[n] = N[m]
    T[n] = T[m]
    return N[n]
  }

  let t = 1
  N[n] = ''
  T[n] = new Array(256)
  do {
    type = B[t][TOK_TYPE].ReadByte()

    switch (type) {
      case TOK_CHAR:
        T[n][t] = B[t][TOK_CHAR].ReadChar()
        break

      case TOK_STRING:
        T[n][t] = B[t][TOK_STRING].ReadString()
        break

      case TOK_DIGITS:
        T[n][t] = B[t][TOK_DIGITS].ReadUint32()
        break

      case TOK_DIGITS0:
        var d = B[t][TOK_DIGITS0].ReadUint32()
        var l = B[t][TOK_DZLEN].ReadByte()
        T[n][t] = LeftPadNumber(d, l)
        break

      case TOK_DELTA:
        T[n][t] = (T[m][t] >> 0) + B[t][TOK_DELTA].ReadByte()
        break

      case TOK_DELTA0:
        var d = (T[m][t] >> 0) + B[t][TOK_DELTA0].ReadByte()
        var l = T[m][t].length
        T[n][t] = LeftPadNumber(d, l)
        break

      case TOK_MATCH:
        T[n][t] = T[m][t]
        break

      default:
        T[n][t] = ''
        break
    }

    N[n] += T[n][t++]
  } while (type != TOK_END)

  return N[n]
}

// ----------------------------------------------------------------------
// Main tokeniser decode entry function: decodes a compressed src and
// returns the uncompressed buffer.
export function decode(src, len, separator) {
  var src = new IOStream(src)
  const ulen = src.ReadUint32()
  const nnames = src.ReadUint32()
  const use_arith = src.ReadByte()

  const B = DecodeTokenByteStreams(src, len, use_arith, nnames)
  const N = new Array(nnames)
  const T = new Array(nnames)

  let str = ''
  if (separator === undefined) {
    separator = '\n'
  }
  for (let i = 0; i < nnames; i++) {
    str += DecodeSingleName(B, N, T, i) + separator
  }

  return str
}
