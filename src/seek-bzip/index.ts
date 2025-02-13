// @ts-nocheck
/*
seek-bzip - a pure-javascript module for seeking within bzip2 data

Copyright (C) 2013 C. Scott Ananian
Copyright (C) 2012 Eli Skeggs
Copyright (C) 2011 Kevin Kwok

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

Adapted from node-bzip, copyright 2012 Eli Skeggs.
Adapted from bzip2.js, copyright 2011 Kevin Kwok (antimatter15@gmail.com).

Based on micro-bunzip by Rob Landley (rob@landley.net).

Based on bzip2 decompression code by Julian R Seward (jseward@acm.org),
which also acknowledges contributions by Mike Burrows, David Wheeler,
Peter Fenwick, Alistair Moffat, Radford Neal, Ian H. Witten,
Robert Sedgewick, and Jon L. Bentley.
*/

import BitReader from './bitreader'
import CRC32 from './crc32'
import Stream from './stream'

const MAX_HUFCODE_BITS = 20
const MAX_SYMBOLS = 258
const SYMBOL_RUNA = 0
const SYMBOL_RUNB = 1
const MIN_GROUPS = 2
const MAX_GROUPS = 6
const GROUP_SIZE = 50

const WHOLEPI = '314159265359'
const SQRTPI = '177245385090'

const mtf = function (array, index) {
  const src = array[index]
  for (let i = index; i > 0; i--) {
    array[i] = array[i - 1]
  }
  array[0] = src
  return src
}

const Err = {
  OK: 0,
  LAST_BLOCK: -1,
  NOT_BZIP_DATA: -2,
  UNEXPECTED_INPUT_EOF: -3,
  UNEXPECTED_OUTPUT_EOF: -4,
  DATA_ERROR: -5,
  OUT_OF_MEMORY: -6,
  OBSOLETE_INPUT: -7,
  END_OF_BLOCK: -8,
}
const ErrorMessages = {}
ErrorMessages[Err.LAST_BLOCK] = 'Bad file checksum'
ErrorMessages[Err.NOT_BZIP_DATA] = 'Not bzip data'
ErrorMessages[Err.UNEXPECTED_INPUT_EOF] = 'Unexpected input EOF'
ErrorMessages[Err.UNEXPECTED_OUTPUT_EOF] = 'Unexpected output EOF'
ErrorMessages[Err.DATA_ERROR] = 'Data error'
ErrorMessages[Err.OUT_OF_MEMORY] = 'Out of memory'
ErrorMessages[Err.OBSOLETE_INPUT] =
  'Obsolete (pre 0.9.5) bzip format not supported.'

const _throw = function (status, optDetail) {
  let msg = ErrorMessages[status] || 'unknown error'
  if (optDetail) {
    msg += ': ' + optDetail
  }
  const e = new TypeError(msg)
  e.errorCode = status
  throw e
}

class Bunzip {
  constructor(inputStream, outputStream) {
    this.writePos = this.writeCurrent = this.writeCount = 0

    this._start_bunzip(inputStream, outputStream)
  }
  _init_block() {
    const moreBlocks = this._get_next_block()
    if (!moreBlocks) {
      this.writeCount = -1
      return false /* no more blocks */
    }
    this.blockCRC = new CRC32()
    return true
  }
  /* XXX micro-bunzip uses (inputStream, inputBuffer, len) as arguments */
  _start_bunzip(inputStream, outputStream) {
    /* Ensure that file starts with "BZh['1'-'9']." */
    const buf = new Uint8Array(4)
    if (
      inputStream.read(buf, 0, 4) !== 4 ||
      String.fromCharCode(buf[0], buf[1], buf[2]) !== 'BZh'
    ) {
      _throw(Err.NOT_BZIP_DATA, 'bad magic')
    }

    const level = buf[3] - 0x30
    if (level < 1 || level > 9) {
      _throw(Err.NOT_BZIP_DATA, 'level out of range')
    }

    this.reader = new BitReader(inputStream)

    /* Fourth byte (ascii '1'-'9'), indicates block size in units of 100k of
     uncompressed data.  Allocate intermediate buffer for block. */
    this.dbufSize = 100000 * level
    this.nextoutput = 0
    this.outputStream = outputStream
    this.streamCRC = 0
  }
  _get_next_block() {
    let i, j, k
    const reader = this.reader
    // this is get_next_block() function from micro-bunzip:
    /* Read in header signature and CRC, then validate signature.
     (last block signature means CRC is for whole file, return now) */
    const h = reader.pi()
    if (h === SQRTPI) {
      // last block
      return false /* no more blocks */
    }
    if (h !== WHOLEPI) {
      _throw(Err.NOT_BZIP_DATA)
    }
    this.targetBlockCRC = reader.read(32) >>> 0 // (convert to unsigned)
    this.streamCRC =
      (this.targetBlockCRC ^
        ((this.streamCRC << 1) | (this.streamCRC >>> 31))) >>>
      0
    /* We can add support for blockRandomised if anybody complains.  There was
     some code for this in busybox 1.0.0-pre3, but nobody ever noticed that
     it didn't actually work. */
    if (reader.read(1)) {
      _throw(Err.OBSOLETE_INPUT)
    }
    const origPointer = reader.read(24)
    if (origPointer > this.dbufSize) {
      _throw(Err.DATA_ERROR, 'initial position out of bounds')
    }
    /* mapping table: if some byte values are never used (encoding things
     like ascii text), the compression code removes the gaps to have fewer
     symbols to deal with, and writes a sparse bitfield indicating which
     values were present.  We make a translation table to convert the symbols
     back to the corresponding bytes. */
    let t = reader.read(16)
    let symToByte = new Uint8Array(256),
      symTotal = 0
    for (i = 0; i < 16; i++) {
      if (t & (1 << (0xf - i))) {
        const o = i * 16
        k = reader.read(16)
        for (j = 0; j < 16; j++) {
          if (k & (1 << (0xf - j))) {
            symToByte[symTotal++] = o + j
          }
        }
      }
    }

    /* How many different huffman coding groups does this block use? */
    const groupCount = reader.read(3)
    if (groupCount < MIN_GROUPS || groupCount > MAX_GROUPS) {
      _throw(Err.DATA_ERROR)
    }
    /* nSelectors: Every GROUP_SIZE many symbols we select a new huffman coding
     group.  Read in the group selector list, which is stored as MTF encoded
     bit runs.  (MTF=Move To Front, as each value is used it's moved to the
     start of the list.) */
    const nSelectors = reader.read(15)
    if (nSelectors === 0) {
      _throw(Err.DATA_ERROR)
    }

    const mtfSymbol = new Uint8Array(256)
    for (i = 0; i < groupCount; i++) {
      mtfSymbol[i] = i
    }

    const selectors = new Uint8Array(nSelectors) // was 32768...

    for (i = 0; i < nSelectors; i++) {
      /* Get next value */
      for (j = 0; reader.read(1); j++) {
        if (j >= groupCount) {
          _throw(Err.DATA_ERROR)
        }
      }
      /* Decode MTF to get the next selector */
      selectors[i] = mtf(mtfSymbol, j)
    }

    /* Read the huffman coding tables for each group, which code for symTotal
     literal symbols, plus two run symbols (RUNA, RUNB) */
    let symCount = symTotal + 2
    let groups = [],
      hufGroup
    for (j = 0; j < groupCount; j++) {
      const length = new Uint8Array(symCount),
        temp = new Uint16Array(MAX_HUFCODE_BITS + 1)
      /* Read huffman code lengths for each symbol.  They're stored in
       a way similar to mtf; record a starting value for the first symbol,
       and an offset from the previous value for everys symbol after that. */
      t = reader.read(5) // lengths
      for (i = 0; i < symCount; i++) {
        for (;;) {
          if (t < 1 || t > MAX_HUFCODE_BITS) {
            _throw(Err.DATA_ERROR)
          }
          /* If first bit is 0, stop.  Else second bit indicates whether
           to increment or decrement the value. */
          if (!reader.read(1)) {
            break
          }
          if (!reader.read(1)) {
            t++
          } else {
            t--
          }
        }
        length[i] = t
      }

      /* Find largest and smallest lengths in this group */
      var minLen, maxLen
      minLen = maxLen = length[0]
      for (i = 1; i < symCount; i++) {
        if (length[i] > maxLen) {
          maxLen = length[i]
        } else if (length[i] < minLen) {
          minLen = length[i]
        }
      }

      /* Calculate permute[], base[], and limit[] tables from length[].
       *
       * permute[] is the lookup table for converting huffman coded symbols
       * into decoded symbols.  base[] is the amount to subtract from the
       * value of a huffman symbol of a given length when using permute[].
       *
       * limit[] indicates the largest numerical value a symbol with a given
       * number of bits can have.  This is how the huffman codes can vary in
       * length: each code with a value>limit[length] needs another bit.
       */
      hufGroup = {}
      groups.push(hufGroup)
      hufGroup.permute = new Uint16Array(MAX_SYMBOLS)
      hufGroup.limit = new Uint32Array(MAX_HUFCODE_BITS + 2)
      hufGroup.base = new Uint32Array(MAX_HUFCODE_BITS + 1)
      hufGroup.minLen = minLen
      hufGroup.maxLen = maxLen
      /* Calculate permute[].  Concurently, initialize temp[] and limit[]. */
      let pp = 0
      for (i = minLen; i <= maxLen; i++) {
        temp[i] = hufGroup.limit[i] = 0
        for (t = 0; t < symCount; t++) {
          if (length[t] === i) {
            hufGroup.permute[pp++] = t
          }
        }
      }
      /* Count symbols coded for at each bit length */
      for (i = 0; i < symCount; i++) {
        temp[length[i]]++
      }
      /* Calculate limit[] (the largest symbol-coding value at each bit
       * length, which is (previous limit<<1)+symbols at this level), and
       * base[] (number of symbols to ignore at each bit length, which is
       * limit minus the cumulative count of symbols coded for already). */
      pp = t = 0
      for (i = minLen; i < maxLen; i++) {
        pp += temp[i]
        /* We read the largest possible symbol size and then unget bits
         after determining how many we need, and those extra bits could
         be set to anything.  (They're noise from future symbols.)  At
         each level we're really only interested in the first few bits,
         so here we set all the trailing to-be-ignored bits to 1 so they
         don't affect the value>limit[length] comparison. */
        hufGroup.limit[i] = pp - 1
        pp <<= 1
        t += temp[i]
        hufGroup.base[i + 1] = pp - t
      }
      hufGroup.limit[maxLen + 1] =
        Number.MAX_VALUE /* Sentinal value for reading next sym. */
      hufGroup.limit[maxLen] = pp + temp[maxLen] - 1
      hufGroup.base[minLen] = 0
    }
    /* We've finished reading and digesting the block header.  Now read this
     block's huffman coded symbols from the file and undo the huffman coding
     and run length encoding, saving the result into dbuf[dbufCount++]=uc */

    /* Initialize symbol occurrence counters and symbol Move To Front table */
    const byteCount = new Uint32Array(256)
    for (i = 0; i < 256; i++) {
      mtfSymbol[i] = i
    }
    /* Loop through compressed symbols. */
    let runPos = 0,
      dbufCount = 0,
      selector = 0,
      uc
    const dbuf = (this.dbuf = new Uint32Array(this.dbufSize))
    symCount = 0
    for (;;) {
      /* Determine which huffman coding group to use. */
      if (!symCount--) {
        symCount = GROUP_SIZE - 1
        if (selector >= nSelectors) {
          _throw(Err.DATA_ERROR)
        }
        hufGroup = groups[selectors[selector++]]
      }
      /* Read next huffman-coded symbol. */
      i = hufGroup.minLen
      j = reader.read(i)
      for (; ; i++) {
        if (i > hufGroup.maxLen) {
          _throw(Err.DATA_ERROR)
        }
        if (j <= hufGroup.limit[i]) {
          break
        }
        j = (j << 1) | reader.read(1)
      }
      /* Huffman decode value to get nextSym (with bounds checking) */
      j -= hufGroup.base[i]
      if (j < 0 || j >= MAX_SYMBOLS) {
        _throw(Err.DATA_ERROR)
      }
      const nextSym = hufGroup.permute[j]
      /* We have now decoded the symbol, which indicates either a new literal
       byte, or a repeated run of the most recent literal byte.  First,
       check if nextSym indicates a repeated run, and if so loop collecting
       how many times to repeat the last literal. */
      if (nextSym === SYMBOL_RUNA || nextSym === SYMBOL_RUNB) {
        /* If this is the start of a new run, zero out counter */
        if (!runPos) {
          runPos = 1
          t = 0
        }
        /* Neat trick that saves 1 symbol: instead of or-ing 0 or 1 at
         each bit position, add 1 or 2 instead.  For example,
         1011 is 1<<0 + 1<<1 + 2<<2.  1010 is 2<<0 + 2<<1 + 1<<2.
         You can make any bit pattern that way using 1 less symbol than
         the basic or 0/1 method (except all bits 0, which would use no
         symbols, but a run of length 0 doesn't mean anything in this
         context).  Thus space is saved. */
        t += nextSym === SYMBOL_RUNA ? runPos : 2 * runPos
        runPos <<= 1
        continue
      }
      /* When we hit the first non-run symbol after a run, we now know
       how many times to repeat the last literal, so append that many
       copies to our buffer of decoded symbols (dbuf) now.  (The last
       literal used is the one at the head of the mtfSymbol array.) */
      if (runPos) {
        runPos = 0
        if (dbufCount + t > this.dbufSize) {
          _throw(Err.DATA_ERROR)
        }
        uc = symToByte[mtfSymbol[0]]
        byteCount[uc] += t
        while (t--) {
          dbuf[dbufCount++] = uc
        }
      }
      /* Is this the terminating symbol? */
      if (nextSym > symTotal) {
        break
      }
      /* At this point, nextSym indicates a new literal character.  Subtract
       one to get the position in the MTF array at which this literal is
       currently to be found.  (Note that the result can't be -1 or 0,
       because 0 and 1 are RUNA and RUNB.  But another instance of the
       first symbol in the mtf array, position 0, would have been handled
       as part of a run above.  Therefore 1 unused mtf position minus
       2 non-literal nextSym values equals -1.) */
      if (dbufCount >= this.dbufSize) {
        _throw(Err.DATA_ERROR)
      }
      i = nextSym - 1
      uc = mtf(mtfSymbol, i)
      uc = symToByte[uc]
      /* We have our literal byte.  Save it into dbuf. */
      byteCount[uc]++
      dbuf[dbufCount++] = uc
    }
    /* At this point, we've read all the huffman-coded symbols (and repeated
     runs) for this block from the input stream, and decoded them into the
     intermediate buffer.  There are dbufCount many decoded bytes in dbuf[].
     Now undo the Burrows-Wheeler transform on dbuf.
     See http://dogma.net/markn/articles/bwt/bwt.htm
  */
    if (origPointer < 0 || origPointer >= dbufCount) {
      _throw(Err.DATA_ERROR)
    }
    /* Turn byteCount into cumulative occurrence counts of 0 to n-1. */
    j = 0
    for (i = 0; i < 256; i++) {
      k = j + byteCount[i]
      byteCount[i] = j
      j = k
    }
    /* Figure out what order dbuf would be in if we sorted it. */
    for (i = 0; i < dbufCount; i++) {
      uc = dbuf[i] & 0xff
      dbuf[byteCount[uc]] |= i << 8
      byteCount[uc]++
    }
    /* Decode first byte by hand to initialize "previous" byte.  Note that it
     doesn't get output, and if the first three characters are identical
     it doesn't qualify as a run (hence writeRunCountdown=5). */
    let pos = 0,
      current = 0,
      run = 0
    if (dbufCount) {
      pos = dbuf[origPointer]
      current = pos & 0xff
      pos >>= 8
      run = -1
    }
    this.writePos = pos
    this.writeCurrent = current
    this.writeCount = dbufCount
    this.writeRun = run

    return true /* more blocks to come */
  }
  /* Undo burrows-wheeler transform on intermediate buffer to produce output.
   If start_bunzip was initialized with out_fd=-1, then up to len bytes of
   data are written to outbuf.  Return value is number of bytes written or
   error (all errors are negative numbers).  If out_fd!=-1, outbuf and len
   are ignored, data is written to out_fd and return is RETVAL_OK or error.
*/
  _read_bunzip(outputBuffer, len) {
    let copies, previous, outbyte
    /* james@jamestaylor.org: writeCount goes to -1 when the buffer is fully
       decoded, which results in this returning RETVAL_LAST_BLOCK, also
       equal to -1... Confusing, I'm returning 0 here to indicate no
       bytes written into the buffer */
    if (this.writeCount < 0) {
      return 0
    }

    const gotcount = 0
    let dbuf = this.dbuf,
      pos = this.writePos,
      current = this.writeCurrent
    let dbufCount = this.writeCount,
      outputsize = this.outputsize
    let run = this.writeRun

    while (dbufCount) {
      dbufCount--
      previous = current
      pos = dbuf[pos]
      current = pos & 0xff
      pos >>= 8
      if (run++ === 3) {
        copies = current
        outbyte = previous
        current = -1
      } else {
        copies = 1
        outbyte = current
      }
      this.blockCRC.updateCRCRun(outbyte, copies)
      while (copies--) {
        this.outputStream.writeByte(outbyte)
        this.nextoutput++
      }
      if (current != previous) {
        run = 0
      }
    }
    this.writeCount = dbufCount
    // check CRC
    if (this.blockCRC.getCRC() !== this.targetBlockCRC) {
      _throw(
        Err.DATA_ERROR,
        'Bad block CRC ' +
          '(got ' +
          this.blockCRC.getCRC().toString(16) +
          ' expected ' +
          this.targetBlockCRC.toString(16) +
          ')',
      )
    }
    return this.nextoutput
  }
}

const coerceInputStream = function (input) {
  if ('readByte' in input) {
    return input
  }
  const inputStream = new Stream()
  inputStream.pos = 0
  inputStream.readByte = function () {
    return input[this.pos++]
  }
  inputStream.seek = function (pos) {
    this.pos = pos
  }
  inputStream.eof = function () {
    return this.pos >= input.length
  }
  return inputStream
}
const coerceOutputStream = function (output) {
  const outputStream = new Stream()
  let resizeOk = true
  if (output) {
    if (typeof output === 'number') {
      outputStream.buffer = new Uint8Array(output)
      resizeOk = false
    } else if ('writeByte' in output) {
      return output
    } else {
      outputStream.buffer = output
      resizeOk = false
    }
  } else {
    outputStream.buffer = new Uint8Array(16384)
  }
  outputStream.pos = 0
  outputStream.writeByte = function (_byte) {
    if (resizeOk && this.pos >= this.buffer.length) {
      const newBuffer = new Uint8Array(this.buffer.length * 2)
      newBuffer.set(this.buffer)
      this.buffer = newBuffer
    }
    this.buffer[this.pos++] = _byte
  }
  outputStream.getBuffer = function () {
    // trim buffer
    if (this.pos !== this.buffer.length) {
      if (!resizeOk) {
        throw new TypeError('outputsize does not match decoded input')
      }
      const newBuffer = new Uint8Array(this.pos)
      newBuffer.set(this.buffer.slice(0, this.pos))
      this.buffer = newBuffer
    }
    return this.buffer
  }
  outputStream._coerced = true
  return outputStream
}

/* Static helper functions */
// 'input' can be a stream or a buffer
// 'output' can be a stream or a buffer or a number (buffer size)
export function decode(input: Uint8Array, output?: any, multistream?: any) {
  // make a stream from a buffer, if necessary
  const inputStream = coerceInputStream(input)
  const outputStream = coerceOutputStream(output)

  const bz = new Bunzip(inputStream, outputStream)
  while (true) {
    if ('eof' in inputStream && inputStream.eof()) {
      break
    }
    if (bz._init_block()) {
      bz._read_bunzip()
    } else {
      const targetStreamCRC = bz.reader.read(32) >>> 0 // (convert to unsigned)
      if (targetStreamCRC !== bz.streamCRC) {
        _throw(
          Err.DATA_ERROR,
          'Bad stream CRC ' +
            '(got ' +
            bz.streamCRC.toString(16) +
            ' expected ' +
            targetStreamCRC.toString(16) +
            ')',
        )
      }
      if (multistream && 'eof' in inputStream && !inputStream.eof()) {
        // note that start_bunzip will also resync the bit reader to next byte
        bz._start_bunzip(inputStream, outputStream)
      } else {
        break
      }
    }
  }
  if ('getBuffer' in outputStream) {
    return outputStream.getBuffer()
  }
}

export default Bunzip
