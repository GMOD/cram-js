const { CramMalformedError } = require('../errors')

const Constants = require('./constants')
const Decoding = require('./decoding')

function uncompress(
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
  for (let i = 0; i < outputEnd; i += 4) {
    const /* byte */ c0 = D.R[Decoding.get(rans0, Constants.TF_SHIFT)]
    const /* byte */ c1 = D.R[Decoding.get(rans1, Constants.TF_SHIFT)]
    const /* byte */ c2 = D.R[Decoding.get(rans2, Constants.TF_SHIFT)]
    const /* byte */ c3 = D.R[Decoding.get(rans3, Constants.TF_SHIFT)]

    out.putAt(i, c0)
    out.putAt(i + 1, c1)
    out.putAt(i + 2, c2)
    out.putAt(i + 3, c3)

    rans0 = Decoding.advanceSymbolStep(
      rans0,
      syms[0xff & c0],
      Constants.TF_SHIFT,
    )
    rans1 = Decoding.advanceSymbolStep(
      rans1,
      syms[0xff & c1],
      Constants.TF_SHIFT,
    )
    rans2 = Decoding.advanceSymbolStep(
      rans2,
      syms[0xff & c2],
      Constants.TF_SHIFT,
    )
    rans3 = Decoding.advanceSymbolStep(
      rans3,
      syms[0xff & c3],
      Constants.TF_SHIFT,
    )

    rans0 = Decoding.renormalize(rans0, input)
    rans1 = Decoding.renormalize(rans1, input)
    rans2 = Decoding.renormalize(rans2, input)
    rans3 = Decoding.renormalize(rans3, input)
  }

  out.setPosition(outputEnd)
  let /* byte */ c
  switch (outputSize & 3) {
    case 0:
      break
    case 1:
      c = D.R[Decoding.get(rans0, Constants.TF_SHIFT)]
      Decoding.advanceSymbol(rans0, input, syms[0xff & c], Constants.TF_SHIFT)
      out.put(c)
      break

    case 2:
      c = D.R[Decoding.get(rans0, Constants.TF_SHIFT)]
      Decoding.advanceSymbol(rans0, input, syms[0xff & c], Constants.TF_SHIFT)
      out.put(c)

      c = D.R[Decoding.get(rans1, Constants.TF_SHIFT)]
      Decoding.advanceSymbol(rans1, input, syms[0xff & c], Constants.TF_SHIFT)
      out.put(c)
      break

    case 3:
      c = D.R[Decoding.get(rans0, Constants.TF_SHIFT)]
      Decoding.advanceSymbol(rans0, input, syms[0xff & c], Constants.TF_SHIFT)
      out.put(c)

      c = D.R[Decoding.get(rans1, Constants.TF_SHIFT)]
      Decoding.advanceSymbol(rans1, input, syms[0xff & c], Constants.TF_SHIFT)
      out.put(c)

      c = D.R[Decoding.get(rans2, Constants.TF_SHIFT)]
      Decoding.advanceSymbol(rans2, input, syms[0xff & c], Constants.TF_SHIFT)
      out.put(c)
      break

    default:
      throw new CramMalformedError(
        'invalid output size encountered during rANS decoding',
      )
  }

  out.setPosition(0)
}

module.exports = { uncompress }
