const HuffmanIntCodec = require('./huffman')
const ExternalCodec = require('./external')
const ByteArrayStopCodec = require('./byteArrayStop')

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
  // 4: ByteArrayLengthCodec,
  5: ByteArrayStopCodec,
  // 6: BetaCodec,
  // 7: SubexpCodec,
  // 8: GolombRiceCodec,
  // 9: GammaCodec,
}

module.exports = {
  getCodecClassWithId(id) {
    return codecClasses[id]
  },
}
