const Decoding = require('./decoding')
const Frequencies = require('./frequencies')

const D04 = require('./d04')
const D14 = require('./d14')

// const /* int */ ORDER_BYTE_LENGTH = 1
// const /* int */ COMPRESSED_BYTE_LENGTH = 4
const /* int */ RAW_BYTE_LENGTH = 4
// const /* int */ PREFIX_BYTE_LENGTH =
//   ORDER_BYTE_LENGTH + COMPRESSED_BYTE_LENGTH + RAW_BYTE_LENGTH

// enum ORDER {
//     ZERO, ONE;

//     static ORDER fromInt(const /* int */ value) {
//         try {
//             return ORDER.values()[value];
//         } catch (const ArrayIndexOutOfBoundsException e) {
//             throw new RuntimeException("Unknown rANS order: " + value);
//         }
//     }
// }

// static ByteBuffer compress(const ByteBuffer input, const ORDER order, const ByteBuffer out) {
//     if (input.remaining() == 0)
//         return EMPTY_BUFFER;

//     if (input.remaining() < 4)
//         return encode_order0_way4(input, out);

//     switch (order) {
//         case ZERO:
//             return encode_order0_way4(input, out);
//         case ONE:
//             return encode_order1_way4(input, out);

//         default:
//             throw new RuntimeException("Unknown rANS order: " + order);
//     }
// }

// static /* ByteBuffer */ allocateIfNeeded(/* const int */ in_size,
//                                            /* const ByteBuffer */ out_buf) {
//     const /* int */ compressedSize = (/* int */) (1.05 * in_size + 257 * 257 * 3 + 4);
//     if (out_buf == null)
//         return ByteBuffer.allocate(compressedSize);
//     if (out_buf.remaining() < compressedSize)
//         throw new RuntimeException("Insufficient buffer size.");
//     out_buf.order(ByteOrder.LITTLE_ENDIAN);
//     return out_buf;
// }

// static ByteBuffer encode_order0_way4(const ByteBuffer input,
//                                              ByteBuffer out_buf) {
//     const /* int */ in_size = input.remaining();
//     out_buf = allocateIfNeeded(in_size, out_buf);
//     const /* int */ freqTableStart = PREFIX_BYTE_LENGTH;
//     out_buf.position(freqTableStart);

//     const /* int */[] F = Frequencies.calcFrequencies_o0(in);
//     const RansEncSymbol[] syms = Frequencies.buildSyms_o0(F);

//     const ByteBuffer cp = out_buf.slice();
//     const /* int */ frequencyTable_size = Frequencies.writeFrequencies_o0(cp, F);

//     input.rewind();
//     const /* int */ compressedBlob_size = E04.compress(input, syms, cp);

//     finalizeCompressed(0, out_buf, in_size, frequencyTable_size,
//             compressedBlob_size);
//     return out_buf;
// }

// static ByteBuffer encode_order1_way4(const ByteBuffer input,
//                                              ByteBuffer out_buf) {
//     const /* int */ in_size = input.remaining();
//     out_buf = allocateIfNeeded(in_size, out_buf);
//     const /* int */ freqTableStart = PREFIX_BYTE_LENGTH;
//     out_buf.position(freqTableStart);

//     const /* int */[][] F = Frequencies.calcFrequencies_o1(in);
//     const RansEncSymbol[][] syms = Frequencies.buildSyms_o1(F);

//     const ByteBuffer cp = out_buf.slice();
//     const /* int */ frequencyTable_size = Frequencies.writeFrequencies_o1(cp, F);

//     input.rewind();
//     const /* int */ compressedBlob_size = E14.compress(input, syms, cp);

//     finalizeCompressed(1, out_buf, in_size, frequencyTable_size,
//             compressedBlob_size);
//     return out_buf;
// }

// static void finalizeCompressed(const /* int */ order, const ByteBuffer out_buf,
//                                        const /* int */ in_size, const /* int */ frequencyTable_size, const /* int */ compressedBlob_size) {
//     out_buf.limit(PREFIX_BYTE_LENGTH + frequencyTable_size
//             + compressedBlob_size);
//     out_buf.put(0, (byte) order);
//     out_buf.order(ByteOrder.LITTLE_ENDIAN);
//     const /* int */ compressedSizeOffset = ORDER_BYTE_LENGTH;
//     out_buf.putInt(compressedSizeOffset, frequencyTable_size
//             + compressedBlob_size);
//     const /* int */ rawSizeOffset = ORDER_BYTE_LENGTH + COMPRESSED_BYTE_LENGTH;
//     out_buf.putInt(rawSizeOffset, in_size);
//     out_buf.rewind();
// }

function /* static ByteBuffer */ uncompressOrder0Way4(
  /* const ByteBuffer  */ input,
  /* const ByteBuffer  */ out,
) {
  // input.order(ByteOrder.LITTLE_ENDIAN);
  const D = new Decoding.AriDecoder()
  const syms = new Array(256)
  for (let i = 0; i < syms.length; i += 1) syms[i] = new Decoding.Symbol()

  Frequencies.readStatsO0(input, D, syms)

  D04.uncompress(input, D, syms, out)

  return out
}

function /* static ByteBuffer */ uncompressOrder1Way4(
  /* const ByteBuffer */ input,
  /* const ByteBuffer */ output,
) {
  const D = new Decoding.AriDecoder[256]()
  const /* Decoding.RansDecSymbol[][]  */ syms = new Array(256)
  for (let i = 0; i < syms.length; i += 1) {
    syms[i] = new Array(256)
    for (let j = 0; j < syms[i].length; j += 1)
      syms[i][j] = new Decoding.Symbol()
  }
  Frequencies.readStatsO1(input, D, syms)

  D14.uncompress(input, output, D, syms)

  return output
}

/** compat layer to make a node buffer act like a java ByteBuffer */
class ByteBuffer {
  constructor(nodeBuffer, initialInputPosition = 0) {
    this._buffer = nodeBuffer
    this._position = initialInputPosition
    this.length = nodeBuffer.length
  }

  get() {
    const b = this._buffer[this._position]
    this._position += 1
    return b
  }

  getByte() {
    return this.get()
  }

  getByteAt(position) {
    return this._buffer[position]
  }

  position() {
    return this._position
  }

  put(val) {
    this._buffer[this._position] = val
    this._position += 1
    return val
  }

  putAt(position, val) {
    this._buffer[position] = val
    return val
  }

  setPosition(pos) {
    this._position = pos
    return pos
  }

  getInt() {
    const i = this._buffer.readInt32LE(this._position)
    this._position += 4
    return i
  }

  remaining() {
    return this._buffer.length - this._position
  }
}

// static /* const */ ByteBuffer EMPTY_BUFFER = ByteBuffer.allocate(0);
function uncompress(inputBuffer, outputBuffer, initialInputPosition = 0) {
  if (inputBuffer.length === 0) {
    outputBuffer.fill(0)
    return outputBuffer
  }

  const input = new ByteBuffer(inputBuffer, initialInputPosition)
  // input.order(ByteOrder.LITTLE_ENDIAN);

  const order = input.get()
  if (order !== 0 && order !== 1) throw new Error(`Invalid rANS order ${order}`)

  const /* int */ inputSize = input.getInt()
  if (inputSize !== input.remaining() - RAW_BYTE_LENGTH)
    throw new Error('Incorrect input length.')

  const /* int */ outputSize = input.getInt()
  const output = new ByteBuffer(outputBuffer || Buffer.allocUnsafe(outputSize))
  // TODO output.limit(outputSize)

  if (output.length < outputSize)
    throw new Error(`Output buffer too small to fit ${outputSize} bytes.`)

  switch (order) {
    case 0:
      return uncompressOrder0Way4(input, output)

    case 1:
      return uncompressOrder1Way4(input, output)

    default:
      throw new Error(`Unknown rANS order: ${order}`)
  }
}

module.exports = { uncompress }
