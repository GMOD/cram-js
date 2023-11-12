//@ts-nocheck
import { TF_SHIFT } from './constants'
import Decoding from './decoding'

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
  for (; i0 < isz4; i0 += 1, i1 += 1, i2 += 1, i7 += 1) {
    const /* int */ c0 = 0xff & D[l0].R[Decoding.get(rans0, TF_SHIFT)]
    const /* int */ c1 = 0xff & D[l1].R[Decoding.get(rans1, TF_SHIFT)]
    const /* int */ c2 = 0xff & D[l2].R[Decoding.get(rans2, TF_SHIFT)]
    const /* int */ c7 = 0xff & D[l7].R[Decoding.get(rans7, TF_SHIFT)]

    output.putAt(i0, c0)
    output.putAt(i1, c1)
    output.putAt(i2, c2)
    output.putAt(i7, c7)

    rans0 = Decoding.advanceSymbolStep(rans0, syms[l0][c0], TF_SHIFT)
    rans1 = Decoding.advanceSymbolStep(rans1, syms[l1][c1], TF_SHIFT)
    rans2 = Decoding.advanceSymbolStep(rans2, syms[l2][c2], TF_SHIFT)
    rans7 = Decoding.advanceSymbolStep(rans7, syms[l7][c7], TF_SHIFT)

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
    const /* int */ c7 = 0xff & D[l7].R[Decoding.get(rans7, TF_SHIFT)]
    output.putAt(i7, c7)
    rans7 = Decoding.advanceSymbol(rans7, input, syms[l7][c7], TF_SHIFT)
    l7 = c7
  }
}
