const { CramUnimplementedError } = require('../../errors')

const HuffmanIntCodec = require('./huffman')
const ExternalCodec = require('./external')
const ByteArrayStopCodec = require('./byteArrayStop')
const ByteArrayLengthCodec = require('./byteArrayLength')
const BetaCodec = require('./beta')

// class GolombCodec extends CramCodec {}
// class ByteArrayLengthCodec extends CramCodec {}
// class BetaCodec extends CramCodec {}
// class SubexpCodec extends CramCodec {}
// class GolombRiceCodec extends CramCodec {}
// class GammaCodec extends CramCodec {}

const codecClasses = {
  1: ExternalCodec,
  // 2: GolombCodec,
  3: HuffmanIntCodec,
  4: ByteArrayLengthCodec,
  5: ByteArrayStopCodec,
  6: BetaCodec,
  // 7: SubexpCodec,
  // 8: GolombRiceCodec,
  // 9: GammaCodec,
}

function getCodecClassWithId(id) {
  return codecClasses[id]
}

function instantiateCodec(encodingData, dataType) {
  const CodecClass = getCodecClassWithId(
    dataType === 'ignore' ? 0 : encodingData.codecId,
  )
  if (!CodecClass)
    throw new CramUnimplementedError(
      `no codec implemented for codec ID ${encodingData.codecId}`,
    )

  return new CodecClass(encodingData.parameters, dataType, instantiateCodec)
}

module.exports = {
  getCodecClassWithId,
  instantiateCodec,
}
