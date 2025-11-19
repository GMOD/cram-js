// @ts-nocheck
import { CramMalformedError } from '../errors.ts'
import { TF_SHIFT } from './constants.ts'
import Decoding from './decoding.ts'

// Inline constants for performance
const RANS_BYTE_L = 8388608 // 1 << 23
const MASK = 4095 // (1 << 12) - 1

export default function uncompress(
  /* ByteBuffer */ input,
  /* Decoding.AriDecoder */ D,
  /* Decoding.Symbol[] */ syms,
  /* ByteBuffer */ out,
) {
  let rans0 = input.getInt()
  let rans1 = input.getInt()
  let rans2 = input.getInt()
  let rans3 = input.getInt()

  const /* int */ outputSize = out.remaining()
  const /* int */ outputEnd = outputSize & ~3
  const D_R = D.R

  for (let i = 0; i < outputEnd; i += 4) {
    const /* byte */ c0 = D_R[rans0 & MASK]
    const /* byte */ c1 = D_R[rans1 & MASK]
    const /* byte */ c2 = D_R[rans2 & MASK]
    const /* byte */ c3 = D_R[rans3 & MASK]

    out.putAt(i, c0)
    out.putAt(i + 1, c1)
    out.putAt(i + 2, c2)
    out.putAt(i + 3, c3)

    const sym0 = syms[0xff & c0]
    const sym1 = syms[0xff & c1]
    const sym2 = syms[0xff & c2]
    const sym3 = syms[0xff & c3]

    rans0 = sym0.freq * (rans0 >> TF_SHIFT) + (rans0 & MASK) - sym0.start
    rans1 = sym1.freq * (rans1 >> TF_SHIFT) + (rans1 & MASK) - sym1.start
    rans2 = sym2.freq * (rans2 >> TF_SHIFT) + (rans2 & MASK) - sym2.start
    rans3 = sym3.freq * (rans3 >> TF_SHIFT) + (rans3 & MASK) - sym3.start

    // Inline renormalize to avoid function call overhead
    if (rans0 < RANS_BYTE_L) {
      do {
        rans0 = (rans0 << 8) | (0xff & input.get())
      } while (rans0 < RANS_BYTE_L)
    }
    if (rans1 < RANS_BYTE_L) {
      do {
        rans1 = (rans1 << 8) | (0xff & input.get())
      } while (rans1 < RANS_BYTE_L)
    }
    if (rans2 < RANS_BYTE_L) {
      do {
        rans2 = (rans2 << 8) | (0xff & input.get())
      } while (rans2 < RANS_BYTE_L)
    }
    if (rans3 < RANS_BYTE_L) {
      do {
        rans3 = (rans3 << 8) | (0xff & input.get())
      } while (rans3 < RANS_BYTE_L)
    }
  }

  out.setPosition(outputEnd)
  let /* byte */ c: number
  switch (outputSize & 3) {
    case 0:
      break
    case 1:
      c = D.R[Decoding.get(rans0, TF_SHIFT)]
      Decoding.advanceSymbol(rans0, input, syms[0xff & c], TF_SHIFT)
      out.put(c)
      break

    case 2:
      c = D.R[Decoding.get(rans0, TF_SHIFT)]
      Decoding.advanceSymbol(rans0, input, syms[0xff & c], TF_SHIFT)
      out.put(c)

      c = D.R[Decoding.get(rans1, TF_SHIFT)]
      Decoding.advanceSymbol(rans1, input, syms[0xff & c], TF_SHIFT)
      out.put(c)
      break

    case 3:
      c = D.R[Decoding.get(rans0, TF_SHIFT)]
      Decoding.advanceSymbol(rans0, input, syms[0xff & c], TF_SHIFT)
      out.put(c)

      c = D.R[Decoding.get(rans1, TF_SHIFT)]
      Decoding.advanceSymbol(rans1, input, syms[0xff & c], TF_SHIFT)
      out.put(c)

      c = D.R[Decoding.get(rans2, TF_SHIFT)]
      Decoding.advanceSymbol(rans2, input, syms[0xff & c], TF_SHIFT)
      out.put(c)
      break

    default:
      throw new CramMalformedError(
        'invalid output size encountered during rANS decoding',
      )
  }

  out.setPosition(0)
}
