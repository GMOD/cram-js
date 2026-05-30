import CramCodec from './_base.ts'
import { CramMalformedError } from '../../errors.ts'

import type { Cursor, Cursors } from './_base.ts'
import type { HuffmanEncoding } from '../encoding.ts'
import type { CramFileBlock } from '../file.ts'
import type CramSlice from '../slice/index.ts'

/**
 * Inlined getBits for huffman decoding - avoids function call overhead
 */
function getBitsInline(
  data: Uint8Array,
  cursor: Cursor,
  numBits: number,
): number {
  let { bytePosition, bitPosition } = cursor

  // Fast path for single bit (common in huffman)
  if (numBits === 1) {
    const val = (data[bytePosition]! >> bitPosition) & 1
    bitPosition -= 1
    if (bitPosition < 0) {
      bytePosition += 1
      bitPosition = 7
    }
    cursor.bytePosition = bytePosition
    cursor.bitPosition = bitPosition as Cursor['bitPosition']
    return val
  }

  // General case
  let val = 0
  for (let i = 0; i < numBits; i++) {
    val <<= 1
    val |= (data[bytePosition]! >> bitPosition) & 1
    bitPosition -= 1
    if (bitPosition < 0) {
      bytePosition += 1
      bitPosition = 7
    }
  }

  cursor.bytePosition = bytePosition
  cursor.bitPosition = bitPosition
  return val
}

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
  // parallel flat arrays indexed by position in sortedCodes; flat arrays let
  // V8 use monomorphic inline caches in the decode hot path
  private valuesByIndex: number[] = []
  private bitLengthsByIndex: number[] = []
  // sparse lookup: bitCode -> index in sortedCodes, or -1 if absent
  private bitCodeToIndex: number[] = []

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

    // degenerate zero-length huffman code: special-case the decoding.
    // empty codeBook (no codes at all) is also valid for unused data series;
    // decode() will throw 'Huffman symbol not found' if such a codec is used.
    if (this.sortedCodes.length > 0 && this.sortedCodes[0]!.bitLength === 0) {
      this._decode = this._decodeZeroLengthCode
    }
  }

  buildCodeBook() {
    // parse the parameters together into a `codes` data structure
    const codes = new Array<{ symbol: number; bitLength: number }>(
      this.parameters.numCodes,
    )
    for (let i = 0; i < this.parameters.numCodes; i++) {
      codes[i] = {
        symbol: this.parameters.symbols[i]!,
        bitLength: this.parameters.bitLengths[i]!,
      }
    }
    // sort the codes by bit length and symbol value
    codes.sort((a, b) => a.bitLength - b.bitLength || a.symbol - b.symbol)

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

    this.valuesByIndex = this.sortedCodes.map(c => c.value)
    this.bitLengthsByIndex = this.sortedCodes.map(c => c.bitLength)
    if (this.sortedCodes.length > 0) {
      let maxBitCode = 0
      for (const code of this.sortedCodes) {
        if (code.bitCode > maxBitCode) {
          maxBitCode = code.bitCode
        }
      }
      this.bitCodeToIndex = new Array(maxBitCode + 1).fill(-1)
      for (let i = 0; i < this.sortedCodes.length; i++) {
        this.bitCodeToIndex[this.sortedCodes[i]!.bitCode] = i
      }
    }
  }

  decode(
    slice: CramSlice,
    coreDataBlock: CramFileBlock,
    _blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    return this._decode(slice, coreDataBlock, cursors.coreBlock)
  }

  // the special case for zero-length codes
  _decodeZeroLengthCode() {
    return this.sortedCodes[0]!.value
  }

  _decode(_slice: CramSlice, coreDataBlock: CramFileBlock, coreCursor: Cursor) {
    const input = coreDataBlock.content

    let prevLen = 0
    let bits = 0
    for (let i = 0; i < this.sortedCodes.length; i += 1) {
      const length = this.sortedCodes[i]!.bitLength
      const bitsToRead = length - prevLen
      if (bitsToRead > 0) {
        bits <<= bitsToRead
        bits |= getBitsInline(input, coreCursor, bitsToRead)
      }
      prevLen = length
      const index = this.bitCodeToIndex[bits] ?? -1
      if (index > -1 && this.bitLengthsByIndex[index] === length) {
        return this.valuesByIndex[index]!
      }
      while (
        i + 1 < this.sortedCodes.length &&
        this.sortedCodes[i + 1]!.bitLength === length
      ) {
        i += 1
      }
    }
    throw new CramMalformedError('Huffman symbol not found.')
  }
}
