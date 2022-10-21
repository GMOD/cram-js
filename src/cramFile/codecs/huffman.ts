import { CramMalformedError } from '../../errors'
import CramCodec, { Cursor, Cursors } from './_base'
import { getBits } from './getBits'
import { HuffmanEncoding } from '../encoding'
import {
  addInt32,
  assertInt32,
  ensureInt32,
  incrementInt32,
  Int32,
  subtractInt32,
} from '../../branding'
import CramSlice from '../slice'
import { CramFileBlock } from '../file'

function numberOfSetBits(ii: Int32) {
  let i = (ii - (ii >> 1)) & 0x55555555
  i = (i & 0x33333333) + ((i >> 2) & 0x33333333)
  return (((i + (i >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24
}

type Code = { bitLength: Int32; value: Int32; bitCode: Int32 }

export default class HuffmanIntCodec extends CramCodec<
  'byte' | 'int',
  HuffmanEncoding['parameters']
> {
  private codes: Record<Int32, Code> = {}
  private codeBook: Record<Int32, Int32[]> = {}
  private sortedByValue: Code[] = []
  private sortedCodes: Code[] = []
  private sortedValuesByBitCode: Int32[] = []
  private sortedBitCodes: Int32[] = []
  private sortedBitLengthsByBitCode: Int32[] = []
  private bitCodeToValue: Int32[] = []

  constructor(
    parameters: HuffmanEncoding['parameters'],
    dataType: 'byte' | 'int',
  ) {
    super(parameters, dataType)
    if (!['byte', 'int'].includes(this.dataType)) {
      throw new TypeError(
        `${this.dataType} decoding not yet implemented by HUFFMAN_INT codec`,
      )
    }

    this.buildCodeBook()
    this.buildCodes()
    this.buildCaches()

    // if this is a degenerate zero-length huffman code, special-case the decoding
    if (this.sortedCodes[0].bitLength === 0) {
      this._decode = this._decodeZeroLengthCode
    }
  }

  buildCodeBook() {
    // parse the parameters together into a `codes` data structure
    let codes: Array<{ symbol: Int32; bitLength: Int32 }> = new Array(
      this.parameters.numCodes,
    )
    for (let i = 0; i < this.parameters.numCodes; i += 1) {
      codes[i] = {
        symbol: this.parameters.symbols[i],
        bitLength: this.parameters.bitLengths[i],
      }
    }
    // sort the codes by bit length and symbol value
    codes = codes.sort(
      (a, b) => a.bitLength - b.bitLength || a.symbol - b.symbol,
    )

    this.codeBook = {}
    codes.forEach(code => {
      if (!this.codeBook[code.bitLength]) {
        this.codeBook[code.bitLength] = []
      }
      this.codeBook[code.bitLength].push(code.symbol)
    })
  }

  buildCodes() {
    this.codes = {} /*  new TreeMap<Integer, HuffmanBitCode>(); */
    let codeLength = assertInt32(0)
    let codeValue = assertInt32(-1)
    Object.entries(this.codeBook).forEach(([bitLength, symbols]) => {
      const bitLengthInt = ensureInt32(parseInt(bitLength, 10))
      symbols.forEach(symbol => {
        const code = {
          bitLength: bitLengthInt,
          value: symbol,
          bitCode: assertInt32(0),
        }
        codeValue = incrementInt32(codeValue)
        const delta = subtractInt32(bitLengthInt, codeLength) // new length?
        codeValue = ensureInt32(codeValue << delta) // pad with 0's
        code.bitCode = codeValue // calculated: huffman code
        codeLength = addInt32(codeLength, delta) // adjust current code length

        if (numberOfSetBits(codeValue) > bitLengthInt) {
          throw new CramMalformedError('Symbol out of range')
        }

        this.codes[symbol] = code
      })
    })
  }

  buildCaches() {
    this.sortedCodes = Object.values(this.codes).sort(
      (a, b) => a.bitLength - b.bitLength || a.bitCode - b.bitCode,
    )

    // this.sortedValues = this.parameters.values.sort((a,b) => a-b)
    this.sortedByValue = Object.values(this.codes).sort(
      (a, b) => a.value - b.value,
    )

    this.sortedValuesByBitCode = this.sortedCodes.map(c => c.value)
    this.sortedBitCodes = this.sortedCodes.map(c => c.bitCode)
    this.sortedBitLengthsByBitCode = this.sortedCodes.map(c => c.bitLength)
    const maxBitCode = Math.max(...this.sortedBitCodes)

    this.bitCodeToValue = new Array(maxBitCode + 1).fill(-1)
    for (let i = 0; i < this.sortedBitCodes.length; i += 1) {
      this.bitCodeToValue[this.sortedCodes[i].bitCode] = assertInt32(i)
    }
  }

  decode(
    slice: CramSlice,
    coreDataBlock: CramFileBlock,
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    return this._decode(slice, coreDataBlock, cursors.coreBlock)
  }

  // _decodeNull() {
  //   return -1
  // }

  // the special case for zero-length codes
  _decodeZeroLengthCode() {
    return this.sortedCodes[0].value
  }

  _decode(slice: CramSlice, coreDataBlock: CramFileBlock, coreCursor: Cursor) {
    const input = coreDataBlock.content

    let prevLen = assertInt32(0)
    let bits = 0
    for (let i = 0; i < this.sortedCodes.length; i += 1) {
      const length = this.sortedCodes[i].bitLength
      bits <<= length - prevLen
      bits |= getBits(input, coreCursor, subtractInt32(length, prevLen))
      prevLen = length
      {
        const index = this.bitCodeToValue[bits]
        if (index > -1 && this.sortedBitLengthsByBitCode[index] === length) {
          return this.sortedValuesByBitCode[index]
        }

        for (
          let j = i;
          this.sortedCodes[j + 1].bitLength === length &&
          j < this.sortedCodes.length;
          j += 1
        ) {
          i += 1
        }
      }
    }
    throw new CramMalformedError('Huffman symbol not found.')
  }
}
