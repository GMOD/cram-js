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
    decoder.fcF[j] = cp.get() & 0xff
    if (decoder.fcF[j] >= 128) {
      decoder.fcF[j] &= ~128
      decoder.fcF[j] = ((decoder.fcF[j] & 127) << 8) | (cp.get() & 0xff)
    }
    decoder.fcC[j] = x

    Decoding.symbolInit(syms[j], decoder.fcC[j], decoder.fcF[j])

    /* Build reverse lookup table */
    if (!decoder.R) {
      decoder.R = new Array(TOTFREQ)
    }
    decoder.R.fill(j, x, x + decoder.fcF[j])

    x += decoder.fcF[j]

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
      D[i].fcF[j] = 0xff & cp.get()
      if (D[i].fcF[j] >= 128) {
        D[i].fcF[j] &= ~128
        D[i].fcF[j] = ((D[i].fcF[j] & 127) << 8) | (0xff & cp.get())
      }
      D[i].fcC[j] = x

      if (D[i].fcF[j] === 0) {
        D[i].fcF[j] = TOTFREQ
      }

      if (syms[i][j] == null) {
        syms[i][j] = new Decoding.RansDecSymbol()
      }

      Decoding.symbolInit(syms[i][j], D[i].fcC[j], D[i].fcF[j])

      /* Build reverse lookup table */
      if (D[i].R == null) {
        D[i].R = new Array(TOTFREQ)
      }
      D[i].R.fill(j, x, x + D[i].fcF[j])

      x += D[i].fcF[j]
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
