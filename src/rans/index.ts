// @ts-nocheck
import { CramMalformedError } from '../errors.ts'
import D04 from './d04.ts'
import D14 from './d14.ts'
import Decoding from './decoding.ts'
import { readStatsO0, readStatsO1 } from './frequencies.ts'

class RansDecoderPool {
  constructor() {
    this.order0Decoders = []
    this.order1Decoders = []
  }

  getOrder0Objects() {
    let D = this.order0Decoders.pop()
    if (!D) {
      D = new Decoding.AriDecoder()
    }

    let syms = new Array(256)
    for (let i = 0; i < 256; i += 1) {
      syms[i] = new Decoding.DecodingSymbol()
    }

    return { D, syms }
  }

  returnOrder0Objects(D) {
    if (D.R) {
      D.R = null
    }
    this.order0Decoders.push(D)
  }

  getOrder1Objects() {
    let result = this.order1Decoders.pop()

    if (!result) {
      const D = new Array(256)
      for (let i = 0; i < 256; i += 1) {
        D[i] = new Decoding.AriDecoder()
      }

      const syms = new Array(256)
      for (let i = 0; i < 256; i += 1) {
        syms[i] = new Array(256)
        for (let j = 0; j < 256; j += 1) {
          syms[i][j] = new Decoding.DecodingSymbol()
        }
      }

      result = { D, syms }
    }

    return result
  }

  returnOrder1Objects(obj) {
    for (let i = 0; i < 256; i += 1) {
      if (obj.D[i] && obj.D[i].R) {
        obj.D[i].R = null
      }
    }
    this.order1Decoders.push(obj)
  }
}

const decoderPool = new RansDecoderPool()

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
  const { D, syms } = decoderPool.getOrder0Objects()

  readStatsO0(input, D, syms)

  D04(input, D, syms, out)

  decoderPool.returnOrder0Objects(D)

  return out
}

function /* static ByteBuffer */ uncompressOrder1Way4(
  /* const ByteBuffer */ input,
  /* const ByteBuffer */ output,
) {
  const obj = decoderPool.getOrder1Objects()

  readStatsO1(input, obj.D, obj.syms)

  D14(input, output, obj.D, obj.syms)

  decoderPool.returnOrder1Objects(obj)

  return output
}

/* compat layer to make a node buffer act like a java ByteBuffer */
class ByteBuffer {
  constructor(nodeBuffer, initialInputPosition = 0) {
    this._buffer = nodeBuffer
    this._dataView = new DataView(nodeBuffer.buffer)
    this._position = initialInputPosition
    this.length = nodeBuffer.length
  }

  get() {
    return this._buffer[this._position++]
  }

  getByte() {
    return this._buffer[this._position++]
  }

  getByteAt(position) {
    return this._buffer[position]
  }

  position() {
    return this._position
  }

  put(val) {
    this._buffer[this._position++] = val
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
    const i = this._dataView.getInt32(this._position, true)
    this._position += 4
    return i
  }

  remaining() {
    return this.length - this._position
  }
}

// static /* const */ ByteBuffer EMPTY_BUFFER = ByteBuffer.allocate(0);
export default function uncompress(
  inputBuffer,
  outputBuffer,
  initialInputPosition = 0,
) {
  if (inputBuffer.length === 0) {
    outputBuffer.fill(0)
    return outputBuffer
  }

  const input = new ByteBuffer(inputBuffer, initialInputPosition)
  // input.order(ByteOrder.LITTLE_ENDIAN);

  const order = input.get()
  if (order !== 0 && order !== 1) {
    throw new CramMalformedError(`Invalid rANS order ${order}`)
  }

  const /* int */ inputSize = input.getInt()
  if (inputSize !== input.remaining() - RAW_BYTE_LENGTH) {
    throw new CramMalformedError('Incorrect input length.')
  }

  const /* int */ outputSize = input.getInt()
  const output = new ByteBuffer(outputBuffer || new Uint8Array(outputSize))
  // TODO output.limit(outputSize)

  if (output.length < outputSize) {
    throw new CramMalformedError(
      `Output buffer too small to fit ${outputSize} bytes.`,
    )
  }

  switch (order) {
    case 0:
      return uncompressOrder0Way4(input, output)

    case 1:
      return uncompressOrder1Way4(input, output)

    default:
      throw new CramMalformedError(`Invalid rANS order: ${order}`)
  }
}
