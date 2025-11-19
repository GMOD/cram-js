// @ts-nocheck
import { TF_SHIFT } from './constants.ts'

// Inline constants for performance
const RANS_BYTE_L = 8388608 // 1 << 23
const MASK = 4095 // (1 << 12) - 1

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

  const inputBuffer = input._buffer
  let inputPos = input.position()
  const outputBuffer = output._buffer
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
    const D_l0_R = D[l0].R
    const D_l1_R = D[l1].R
    const D_l2_R = D[l2].R
    const D_l7_R = D[l7].R

    const /* int */ c0 = D_l0_R[rans0 & MASK]
    const /* int */ c1 = D_l1_R[rans1 & MASK]
    const /* int */ c2 = D_l2_R[rans2 & MASK]
    const /* int */ c7 = D_l7_R[rans7 & MASK]

    // Inline putAt to avoid function call overhead
    outputBuffer[i0] = c0
    outputBuffer[i1] = c1
    outputBuffer[i2] = c2
    outputBuffer[i7] = c7

    const sym_l0_c0 = syms[l0][c0]
    const sym_l1_c1 = syms[l1][c1]
    const sym_l2_c2 = syms[l2][c2]
    const sym_l7_c7 = syms[l7][c7]

    rans0 =
      sym_l0_c0.freq * (rans0 >> TF_SHIFT) + (rans0 & MASK) - sym_l0_c0.start
    rans1 =
      sym_l1_c1.freq * (rans1 >> TF_SHIFT) + (rans1 & MASK) - sym_l1_c1.start
    rans2 =
      sym_l2_c2.freq * (rans2 >> TF_SHIFT) + (rans2 & MASK) - sym_l2_c2.start
    rans7 =
      sym_l7_c7.freq * (rans7 >> TF_SHIFT) + (rans7 & MASK) - sym_l7_c7.start

    // Inline renormalize to avoid function call overhead
    if (rans0 < RANS_BYTE_L) {
      do {
        rans0 = (rans0 << 8) | inputBuffer[inputPos++]
      } while (rans0 < RANS_BYTE_L)
    }
    if (rans1 < RANS_BYTE_L) {
      do {
        rans1 = (rans1 << 8) | inputBuffer[inputPos++]
      } while (rans1 < RANS_BYTE_L)
    }
    if (rans2 < RANS_BYTE_L) {
      do {
        rans2 = (rans2 << 8) | inputBuffer[inputPos++]
      } while (rans2 < RANS_BYTE_L)
    }
    if (rans7 < RANS_BYTE_L) {
      do {
        rans7 = (rans7 << 8) | inputBuffer[inputPos++]
      } while (rans7 < RANS_BYTE_L)
    }

    l0 = c0
    l1 = c1
    l2 = c2
    l7 = c7
  }

  // Remainder
  for (; i7 < outputSize; i7 += 1) {
    const /* int */ c7 = D[l7].R[rans7 & MASK]
    // Inline putAt to avoid function call overhead
    outputBuffer[i7] = c7

    // Inline advanceSymbol to avoid function call overhead
    const sym = syms[l7][c7]
    rans7 = sym.freq * (rans7 >> TF_SHIFT) + (rans7 & MASK) - sym.start
    if (rans7 < RANS_BYTE_L) {
      do {
        rans7 = (rans7 << 8) | inputBuffer[inputPos++]
      } while (rans7 < RANS_BYTE_L)
    }

    l7 = c7
  }
}
