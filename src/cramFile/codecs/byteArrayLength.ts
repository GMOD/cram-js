import CramCodec from './_base.ts'

import type { Cursors } from './_base.ts'
import type { ByteArrayLengthEncoding, CramEncoding } from '../encoding.ts'
import type { CramFileBlock } from '../file.ts'
import type { DataType } from './dataSeriesTypes.ts'

type CramCodecFactory = <TData extends DataType = DataType>(
  encodingData: CramEncoding,
  dataType: TData,
) => CramCodec<TData>

// shared zero-length result; every consumer of a byte array only reads it
const EMPTY = new Uint8Array(0)

export default class ByteArrayLengthCodec extends CramCodec<
  'byteArray',
  ByteArrayLengthEncoding['parameters']
> {
  private instantiateCodec: CramCodecFactory
  private _lengthCodecCache?: CramCodec<'int'>
  private _dataCodecCache?: CramCodec<'byte'>

  constructor(
    parameters: ByteArrayLengthEncoding['parameters'],
    dataType: 'byteArray',
    instantiateCodec: CramCodecFactory,
  ) {
    super(parameters, dataType)
    this.instantiateCodec = instantiateCodec
  }

  decode(
    coreDataBlock: CramFileBlock,
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    const lengthCodec = this._getLengthCodec()
    const arrayLength = lengthCodec.decode(
      coreDataBlock,
      blocksByContentId,
      cursors,
    )

    if (arrayLength > 0) {
      const dataCodec = this._getDataCodec()
      const subarray = dataCodec.getBytesSubarray(
        blocksByContentId,
        cursors,
        arrayLength,
      )
      if (subarray) {
        return subarray
      } else {
        const data = new Uint8Array(arrayLength)
        for (let i = 0; i < arrayLength; i += 1) {
          data[i] = dataCodec.decode(coreDataBlock, blocksByContentId, cursors)
        }
        return data
      }
    } else {
      return new Uint8Array(0)
    }
  }

  /**
   * The whole point of the seam: the length side binds through *its* codec,
   * whatever that is, and the values side hands out a view when it can. That
   * is what stops the fast path from being conditional on the length encoding.
   * A fixed-width tag stores its length as a zero-bit huffman code — free to
   * read, and previously the very thing that disqualified the tag from binding
   * at all.
   */
  bindDecoder(
    coreDataBlock: CramFileBlock | undefined,
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    const readLength = this._getLengthCodec().bindDecoder(
      coreDataBlock,
      blocksByContentId,
      cursors,
    )
    const dataCodec = this._getDataCodec()
    const readBytes = dataCodec.bindBytesReader(blocksByContentId, cursors)
    if (readBytes) {
      return () => {
        const arrayLength = readLength()
        return arrayLength > 0 ? readBytes(arrayLength) : EMPTY
      }
    }
    // a values codec that cannot hand out a view: read it a byte at a time
    const readByte = dataCodec.bindDecoder(
      coreDataBlock,
      blocksByContentId,
      cursors,
    )
    return () => {
      const arrayLength = readLength()
      if (arrayLength <= 0) {
        return EMPTY
      }
      const data = new Uint8Array(arrayLength)
      for (let i = 0; i < arrayLength; i += 1) {
        data[i] = readByte()
      }
      return data
    }
  }

  _getLengthCodec() {
    this._lengthCodecCache ??= this.instantiateCodec(
      this.parameters.lengthsEncoding,
      'int',
    )
    return this._lengthCodecCache
  }

  _getDataCodec() {
    this._dataCodecCache ??= this.instantiateCodec(
      this.parameters.valuesEncoding,
      'byte',
    )
    return this._dataCodecCache
  }
}
