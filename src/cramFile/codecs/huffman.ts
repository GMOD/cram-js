import { CramMalformedError } from '../../errors'
import CramCodec, { Cursor, Cursors } from './_base'
import { getBits } from './getBits'
import { HuffmanEncoding } from '../encoding'

import CramSlice from '../slice'
import { CramFileBlock } from '../file'

function numberOfSetBits(ii: number) {
  let i = (ii - (ii >> 1)) & 0x55555555
  i = (i & 0x33333333) + ((i >> 2) & 0x33333333)
  return (((i + (i >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24
}

interface Code {
  bitLength: number
  value: number
  bitCode: number
}

export default class HuffmanIntCodec extends CramCodec<
  'byte' | 'int',
  HuffmanEncoding['parameters']
> {
  private codes: Record<number, Code> = {}
  private codeBook: Record<number, number[]> = {}
  private sortedCodes: Code[] = []
  private sortedValuesByBitCode: number[] = []
  private sortedBitCodes: number[] = []
  private sortedBitLengthsByBitCode: number[] = []
  private bitCodeToValue: number[] = []

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

    // if this is a degenerate zero-length huffman code, special-case the
    // decoding
    if (this.sortedCodes[0]!.bitLength === 0) {
      this._decode = this._decodeZeroLengthCode
    }
  }

  buildCodeBook() {
    // parse the parameters together into a `codes` data structure
    let codes = new Array<{ symbol: number; bitLength: number }>(
      this.parameters.numCodes,
    )
    for (let i = 0; i < this.parameters.numCodes; i++) {
      codes[i] = {
        symbol: this.parameters.symbols[i]!,
        bitLength: this.parameters.bitLengths[i]!,
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
      this.codeBook[code.bitLength]!.push(code.symbol)
    })
  }

  buildCodes() {
    this.codes = {} /*  new TreeMap<Integer, HuffmanBitCode>(); */
    let codeLength = 0
    let codeValue = -1
    Object.entries(this.codeBook).forEach(([bitLength, symbols]) => {
      const bitLengthInt = Number.parseInt(bitLength, 10)
      symbols.forEach(symbol => {
        const code = {
          bitLength: bitLengthInt,
          value: symbol,
          bitCode: 0,
        }
        codeValue = codeValue + 1
        const delta = bitLengthInt - codeLength // new length?
        codeValue = codeValue << delta // pad with 0's
        code.bitCode = codeValue // calculated: huffman code
        codeLength = codeLength + delta // adjust current code length

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

    this.sortedValuesByBitCode = this.sortedCodes.map(c => c.value)
    this.sortedBitCodes = this.sortedCodes.map(c => c.bitCode)
    this.sortedBitLengthsByBitCode = this.sortedCodes.map(c => c.bitLength)
    const maxBitCode = Math.max(...this.sortedBitCodes)

    this.bitCodeToValue = new Array(maxBitCode + 1).fill(-1)
    for (let i = 0; i < this.sortedBitCodes.length; i += 1) {
      this.bitCodeToValue[this.sortedCodes[i]!.bitCode] = i
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
    return this.sortedCodes[0]!.value
  }

  _decode(slice: CramSlice, coreDataBlock: CramFileBlock, coreCursor: Cursor) {
    const input = coreDataBlock.content

    let prevLen = 0
    let bits = 0
    for (let i = 0; i < this.sortedCodes.length; i += 1) {
      const length = this.sortedCodes[i]!.bitLength
      bits <<= length - prevLen
      bits |= getBits(input, coreCursor, length - prevLen)
      prevLen = length
      {
        const index = this.bitCodeToValue[bits]!
        if (index > -1 && this.sortedBitLengthsByBitCode[index] === length) {
          return this.sortedValuesByBitCode[index]!
        }

        for (
          let j = i;
          this.sortedCodes[j + 1]!.bitLength === length &&
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
