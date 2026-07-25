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

export default class HuffmanIntCodec extends CramCodec<
  'byte' | 'int',
  HuffmanEncoding['parameters']
> {
  // Canonical-Huffman decode tables, grouped by bit length. The codes CRAM
  // emits are canonical, so within one bit length the bit codes are
  // consecutive integers — a symbol can therefore be found by subtracting the
  // group's first code, with no per-bit-code lookup table. (An earlier version
  // indexed a flat array by bit code, which is sized 2^maxBitLength and so
  // grows exponentially with the depth of the huffman tree.)
  private groupBitLength: Int32Array
  private groupFirstCode: Int32Array
  private groupFirstIndex: Int32Array
  private groupCount: Int32Array
  private valuesByIndex: Int32Array

  constructor(
    parameters: HuffmanEncoding['parameters'],
    dataType: 'byte' | 'int',
  ) {
    super(parameters, dataType)
    if (this.dataType !== 'byte' && this.dataType !== 'int') {
      throw new TypeError(
        `${this.dataType} decoding not yet implemented by HUFFMAN_INT codec`,
      )
    }

    const { numCodes, symbols, bitLengths } = this.parameters
    const codes = new Array<{ symbol: number; bitLength: number }>(numCodes)
    for (let i = 0; i < numCodes; i++) {
      codes[i] = { symbol: symbols[i]!, bitLength: bitLengths[i]! }
    }
    // ascending (bitLength, symbol) is the order canonical bit codes are
    // assigned in, and therefore also ascending bit code — so the group tables
    // below can be filled in the same pass
    codes.sort((a, b) => a.bitLength - b.bitLength || a.symbol - b.symbol)

    const values: number[] = []
    const groupBitLengths: number[] = []
    const groupFirstCodes: number[] = []
    const groupFirstIndexes: number[] = []
    const groupCounts: number[] = []
    let codeLength = 0
    let codeValue = -1
    for (const { symbol, bitLength } of codes) {
      codeValue = (codeValue + 1) << (bitLength - codeLength)
      codeLength = bitLength
      // a bitLength-bit code cannot exceed bitLength bits. Overflowing means
      // more symbols were assigned a length than that length has codes, so the
      // table is malformed and every symbol past this point would mis-decode
      if (codeValue >= 2 ** bitLength) {
        throw new CramMalformedError('Symbol out of range')
      }

      const group = groupBitLengths.length - 1
      if (group >= 0 && groupBitLengths[group] === bitLength) {
        groupCounts[group]! += 1
      } else {
        groupBitLengths.push(bitLength)
        groupFirstCodes.push(codeValue)
        groupFirstIndexes.push(values.length)
        groupCounts.push(1)
      }
      values.push(symbol)
    }

    this.valuesByIndex = Int32Array.from(values)
    this.groupBitLength = Int32Array.from(groupBitLengths)
    this.groupFirstCode = Int32Array.from(groupFirstCodes)
    this.groupFirstIndex = Int32Array.from(groupFirstIndexes)
    this.groupCount = Int32Array.from(groupCounts)

    // degenerate zero-length huffman code: special-case the decoding.
    // no codes at all is also valid for unused data series; decode() will throw
    // 'Huffman symbol not found' if such a codec is used.
    if (groupBitLengths[0] === 0) {
      this._decode = this._decodeZeroLengthCode
    }
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
    return this.valuesByIndex[0]!
  }

  _decode(coreDataBlock: CramFileBlock, coreCursor: Cursor) {
    const input = coreDataBlock.content
    const { groupBitLength, groupFirstCode, groupCount, groupFirstIndex } = this

    let prevLen = 0
    let bits = 0
    // indexed rather than for-of: this is the innermost bit-decoding loop, and
    // groupBitLength.entries() would allocate an iterator plus an [index, value]
    // tuple on every iteration
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
