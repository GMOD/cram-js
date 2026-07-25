import CramCodec from './_base.ts'
import { CramMalformedError } from '../../errors.ts'

import type { Cursor, Cursors } from './_base.ts'
import type { HuffmanEncoding } from '../encoding.ts'
import type { CramFileBlock } from '../file.ts'

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
  // Canonical-Huffman decode tables, grouped by bit length. The codes CRAM
  // emits are canonical, so within one bit length the bit codes are
  // consecutive integers — a symbol can therefore be found by subtracting the
  // group's first code, with no per-bit-code lookup table. (An earlier version
  // indexed a flat array by bit code, which is sized 2^maxBitLength and so
  // grows exponentially with the depth of the huffman tree.)
  private groupBitLength = new Int32Array(0)
  private groupFirstCode = new Int32Array(0)
  private groupFirstIndex = new Int32Array(0)
  private groupCount = new Int32Array(0)
  private valuesByIndex = new Int32Array(0)

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

    this.valuesByIndex = Int32Array.from(this.sortedCodes, c => c.value)

    // one group per distinct bit length, ascending
    const bitLengths: number[] = []
    const firstCodes: number[] = []
    const firstIndexes: number[] = []
    const counts: number[] = []
    let group = -1
    for (let i = 0; i < this.sortedCodes.length; i++) {
      const code = this.sortedCodes[i]!
      if (group >= 0 && bitLengths[group] === code.bitLength) {
        counts[group]! += 1
      } else {
        group += 1
        bitLengths.push(code.bitLength)
        firstCodes.push(code.bitCode)
        firstIndexes.push(i)
        counts.push(1)
      }
    }
    this.groupBitLength = Int32Array.from(bitLengths)
    this.groupFirstCode = Int32Array.from(firstCodes)
    this.groupFirstIndex = Int32Array.from(firstIndexes)
    this.groupCount = Int32Array.from(counts)
  }

  decode(
    coreDataBlock: CramFileBlock,
    _blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    return this._decode(coreDataBlock, cursors.coreBlock)
  }

  // the special case for zero-length codes
  _decodeZeroLengthCode() {
    return this.sortedCodes[0]!.value
  }

  _decode(coreDataBlock: CramFileBlock, coreCursor: Cursor) {
    const input = coreDataBlock.content
    const { groupBitLength, groupFirstCode, groupCount, groupFirstIndex } = this

    let prevLen = 0
    let bits = 0
    // indexed rather than for-of: this is the innermost bit-decoding loop, and
    // groupBitLength.entries() would allocate an iterator plus an [index, value]
    // tuple on every iteration
    // eslint-disable-next-line unicorn/no-for-loop
    for (let g = 0; g < groupBitLength.length; g += 1) {
      const length = groupBitLength[g]!
      const bitsToRead = length - prevLen
      if (bitsToRead > 0) {
        bits <<= bitsToRead
        bits |= getBitsInline(input, coreCursor, bitsToRead)
      }
      prevLen = length
      const offset = bits - groupFirstCode[g]!
      if (offset >= 0 && offset < groupCount[g]!) {
        return this.valuesByIndex[groupFirstIndex[g]! + offset]!
      }
    }
    throw new CramMalformedError('Huffman symbol not found.')
  }
}
