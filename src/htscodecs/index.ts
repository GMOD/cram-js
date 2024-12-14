// @ts-nocheck
//
/*
 * Copyright (c) 2020 Genome Research Ltd.
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

// This is an interface to the htscodecs reference implementation of
// the CRAM 3.1 codecs.

// This JavaScript file is not part of the reference implementation
// and is simply and interface to get a consistent interface for cram-js.

import arith from './arith_gen'
import * as fqzcomp from './fqzcomp'
import * as r4x8 from './rans'
import * as r4x16 from './rans4x16'
import * as tok3 from './tok3'

export function r4x8_uncompress(inputBuffer: Uint8Array) {
  return r4x8.decode(inputBuffer)
}

export function r4x16_uncompress(inputBuffer: Uint8Array) {
  return r4x16.decode(inputBuffer)
}

export function arith_uncompress(inputBuffer: Uint8Array) {
  // fix by @cmdcolin for CRAM 3.1
  // xref https://github.com/jkbonfield/htscodecs/pull/1/files
  return new arith().decode(inputBuffer)
}

export function fqzcomp_uncompress(inputBuffer: Uint8Array) {
  const q_lens = []
  return fqzcomp.decode(inputBuffer, q_lens)
}

export function tok3_uncompress(inputBuffer: Uint8Array) {
  // Returns in string form instead of buffer
  const out = tok3.decode(inputBuffer, 0, '\0')
  return Uint8Array.from(Array.from(out).map(letter => letter.charCodeAt(0)))
}
