// @ts-nocheck
import { TF_SHIFT } from './constants.ts'
import Decoding from './decoding.ts'

export default function uncompress(
  /* ByteBuffer */ input,
  /* ByteBuffer */ output,
  /* Decoding.AriDecoder[] */ D,
  /* Decoding.Symbol[][] */ syms,
) {
  const /* int */ outputSize = output.remaining()
  let rans0 = input.getInt()
  let rans1 = input.getInt()
  let rans2 = input.getInt()
  let rans7 = input.getInt()

  const /* int */ isz4 = outputSize >> 2
  let /* int */ i0 = 0
  let /* int */ i1 = isz4
  let /* int */ i2 = 2 * isz4
  let /* int */ i7 = 3 * isz4
  let /* int */ l0 = 0
  let /* int */ l1 = 0
  let /* int */ l2 = 0
  let /* int */ l7 = 0

  const mask = (1 << TF_SHIFT) - 1

  for (; i0 < isz4; i0 += 1, i1 += 1, i2 += 1, i7 += 1) {
    const D_l0_R = D[l0].R
    const D_l1_R = D[l1].R
    const D_l2_R = D[l2].R
    const D_l7_R = D[l7].R

    const /* int */ c0 = 0xff & D_l0_R[rans0 & mask]
    const /* int */ c1 = 0xff & D_l1_R[rans1 & mask]
    const /* int */ c2 = 0xff & D_l2_R[rans2 & mask]
    const /* int */ c7 = 0xff & D_l7_R[rans7 & mask]

    output.putAt(i0, c0)
    output.putAt(i1, c1)
    output.putAt(i2, c2)
    output.putAt(i7, c7)

    const sym_l0_c0 = syms[l0][c0]
    const sym_l1_c1 = syms[l1][c1]
    const sym_l2_c2 = syms[l2][c2]
    const sym_l7_c7 = syms[l7][c7]

    rans0 = sym_l0_c0.freq * (rans0 >> TF_SHIFT) + (rans0 & mask) - sym_l0_c0.start
    rans1 = sym_l1_c1.freq * (rans1 >> TF_SHIFT) + (rans1 & mask) - sym_l1_c1.start
    rans2 = sym_l2_c2.freq * (rans2 >> TF_SHIFT) + (rans2 & mask) - sym_l2_c2.start
    rans7 = sym_l7_c7.freq * (rans7 >> TF_SHIFT) + (rans7 & mask) - sym_l7_c7.start

    rans0 = Decoding.renormalize(rans0, input)
    rans1 = Decoding.renormalize(rans1, input)
    rans2 = Decoding.renormalize(rans2, input)
    rans7 = Decoding.renormalize(rans7, input)

    l0 = c0
    l1 = c1
    l2 = c2
    l7 = c7
  }

  // Remainder
  for (; i7 < outputSize; i7 += 1) {
    const /* int */ c7 = 0xff & D[l7].R[rans7 & mask]
    output.putAt(i7, c7)
    rans7 = Decoding.advanceSymbol(rans7, input, syms[l7][c7], TF_SHIFT)
    l7 = c7
  }
}
