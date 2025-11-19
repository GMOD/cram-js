// @ts-nocheck
import { CramMalformedError } from '../errors.ts'
import { TOTFREQ } from './constants.ts'
import Decoding from './decoding.ts'

function assert(result) {
  if (!result) {
    throw new CramMalformedError('assertion failed')
  }
}

export function readStatsO0(
  /* ByteBuffer */ cp,
  /* Decoding.AriDecoder */ decoder,
  /* Decoding.RansDecSymbol[] */ syms,
) {
  // Pre-compute reverse lookup of frequency.
  let rle = 0
  let x = 0
  let j = cp.get() & 0xff
  do {
    if (decoder.fc[j] == null) {
      decoder.fc[j] = new Decoding.FC()
    }
    decoder.fc[j].F = cp.get() & 0xff
    if (decoder.fc[j].F >= 128) {
      decoder.fc[j].F &= ~128
      decoder.fc[j].F = ((decoder.fc[j].F & 127) << 8) | (cp.get() & 0xff)
    }
    decoder.fc[j].C = x

    Decoding.symbolInit(syms[j], decoder.fc[j].C, decoder.fc[j].F)

    /* Build reverse lookup table */
    if (!decoder.R) {
      decoder.R = new Array(TOTFREQ)
    }
    const R = decoder.R
    const end = x + decoder.fc[j].F
    for (let k = x; k < end; k++) {
      R[k] = j
    }

    x += decoder.fc[j].F

    if (rle === 0 && j + 1 === (0xff & cp.getByteAt(cp.position()))) {
      j = cp.get() & 0xff
      rle = cp.get() & 0xff
    } else if (rle !== 0) {
      rle -= 1
      j += 1
    } else {
      j = cp.get() & 0xff
    }
  } while (j !== 0)

  assert(x < TOTFREQ)
}

export function readStatsO1(
  /* ByteBuffer */ cp,
  /*  Decoding.AriDecoder[] */ D,
  /* Decoding.RansDecSymbol[][] */ syms,
) {
  let rlei = 0
  let i = 0xff & cp.get()
  do {
    let rlej = 0
    let x = 0
    let j = 0xff & cp.get()
    if (D[i] == null) {
      D[i] = new Decoding.AriDecoder()
    }
    do {
      if (D[i].fc[j] == null) {
        D[i].fc[j] = new Decoding.FC()
      }
      D[i].fc[j].F = 0xff & cp.get()
      if (D[i].fc[j].F >= 128) {
        D[i].fc[j].F &= ~128
        D[i].fc[j].F = ((D[i].fc[j].F & 127) << 8) | (0xff & cp.get())
      }
      D[i].fc[j].C = x

      if (D[i].fc[j].F === 0) {
        D[i].fc[j].F = TOTFREQ
      }

      if (syms[i][j] == null) {
        syms[i][j] = new Decoding.RansDecSymbol()
      }

      Decoding.symbolInit(syms[i][j], D[i].fc[j].C, D[i].fc[j].F)

      /* Build reverse lookup table */
      if (D[i].R == null) {
        D[i].R = new Array(TOTFREQ)
      }
      const R = D[i].R
      const end = x + D[i].fc[j].F
      for (let k = x; k < end; k++) {
        R[k] = j
      }

      x += D[i].fc[j].F
      assert(x <= TOTFREQ)

      if (rlej === 0 && j + 1 === (0xff & cp.getByteAt(cp.position()))) {
        j = 0xff & cp.get()
        rlej = 0xff & cp.get()
      } else if (rlej !== 0) {
        rlej -= 1
        j += 1
      } else {
        j = 0xff & cp.get()
      }
    } while (j !== 0)

    if (rlei === 0 && i + 1 === (0xff & cp.getByteAt(cp.position()))) {
      i = 0xff & cp.get()
      rlei = 0xff & cp.get()
    } else if (rlei !== 0) {
      rlei -= 1
      i += 1
    } else {
      i = 0xff & cp.get()
    }
  } while (i !== 0)
}
