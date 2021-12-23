import { CramMalformedError } from '../errors'

import { RANS_BYTE_L } from './constants'

class FC {
  // int F, C;
  constructor() {
    this.F = undefined
    this.C = undefined
  }
}

class AriDecoder {
  // final FC[] fc = new FC[256];
  // byte[] R;

  constructor() {
    this.fc = new Array(256)
    for (let i = 0; i < this.fc.length; i += 1) {
      this.fc[i] = new FC()
    }
    this.R = null
  }
}

class Symbol {
  // int start; // Start of range.
  // int freq; // Symbol frequency.
  constructor() {
    this.start = undefined
    this.freq = undefined
  }
}

// Initialize a decoder symbol to start "start" and frequency "freq"
function symbolInit(sym, start, freq) {
  if (!(start <= 1 << 16)) {
    throw new CramMalformedError(`assertion failed: start <= 1<<16`)
  }
  if (!(freq <= (1 << 16) - start)) {
    throw new CramMalformedError(`assertion failed: freq <= 1<<16`)
  }
  sym.start = start
  sym.freq = freq
}

// Advances in the bit stream by "popping" a single symbol with range start
// "start" and frequency "freq". All frequencies are assumed to sum to
// "1 << scaleBits".
// No renormalization or output happens.
/* private static int */ function advanceStep(
  /* final int */ r,
  /* final int */ start,
  /* final int */ freq,
  /* final int */ scaleBits,
) {
  /* final int */ const mask = (1 << scaleBits) - 1

  // s, x = D(x)
  return freq * (r >> scaleBits) + (r & mask) - start
}

// Equivalent to RansDecAdvanceStep that takes a symbol.
/* static int  */ function advanceSymbolStep(
  /* final int */ r,
  /* final RansDecSymbol */ sym,
  /* final int */ scaleBits,
) {
  return advanceStep(r, sym.start, sym.freq, scaleBits)
}

// Returns the current cumulative frequency (map it to a symbol yourself!)
/* static int */ function get(/* final int */ r, /* final int */ scaleBits) {
  return r & ((1 << scaleBits) - 1)
}

// Advances in the bit stream by "popping" a single symbol with range start
// "start" and frequency "freq". All frequencies are assumed to sum to
// "1 << scaleBits",
// and the resulting bytes get written to ptr (which is updated).
/* private static int */ function advance(
  /* int */ r,
  /* final ByteBuffer */ pptr,
  /* final int */ start,
  /* final int */ freq,
  /* final int */ scaleBits,
) {
  /* final int */ const mask = (1 << scaleBits) - 1

  // s, x = D(x)
  r = freq * (r >> scaleBits) + (r & mask) - start

  // re-normalize
  if (r < RANS_BYTE_L) {
    do {
      /* final int */ const b = 0xff & pptr.get()
      r = (r << 8) | b
    } while (r < RANS_BYTE_L)
  }

  return r
}

// Equivalent to RansDecAdvance that takes a symbol.
/*  static int */ function advanceSymbol(
  /* final int */ r,
  /* final ByteBuffer */ pptr,
  /* final RansDecSymbol */ sym,
  /* final int */ scaleBits,
) {
  return advance(r, pptr, sym.start, sym.freq, scaleBits)
}

// Re-normalize.
/*  static int */ function renormalize(
  /* int */ r,
  /* final ByteBuffer */ pptr,
) {
  // re-normalize
  if (r < RANS_BYTE_L) {
    do {
      r = (r << 8) | (0xff & pptr.get())
    } while (r < RANS_BYTE_L)
  }

  return r
}

const Decode = {
  FC,
  AriDecoder,
  Symbol,
  symbolInit,
  advanceStep,
  advanceSymbolStep,
  get,
  advanceSymbol,
  renormalize,
}

export default Decode
