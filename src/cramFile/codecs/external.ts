import { CramMalformedError, CramUnimplementedError } from '../../errors'
import CramCodec, { Cursor, Cursors } from './_base'
import { parseItf8 } from '../util'
import CramSlice from '../slice'
import { CramFileBlock } from '../file'
import { CramBufferOverrunError } from './getBits'
import { ExternalCramEncoding } from '../encoding'

export default class ExternalCodec extends CramCodec<
  'int' | 'byte',
  ExternalCramEncoding['parameters']
> {
  private readonly _decodeData: (
    contentBlock: CramFileBlock,
    cursor: Cursor,
  ) => number

  constructor(
    parameters: ExternalCramEncoding['parameters'],
    dataType: 'int' | 'byte',
  ) {
    super(parameters, dataType)
    if (this.dataType === 'int') {
      this._decodeData = this._decodeInt
    } else if (this.dataType === 'byte') {
      this._decodeData = this._decodeByte
    } else {
      throw new CramUnimplementedError(
        `${this.dataType} decoding not yet implemented by EXTERNAL codec`,
      )
    }
  }

  decode(
    slice: CramSlice,
    coreDataBlock: CramFileBlock,
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    const { blockContentId } = this.parameters
    const contentBlock = blocksByContentId[blockContentId]
    if (!contentBlock) {
      throw new CramMalformedError(
        `no block found with content ID ${blockContentId}`,
      )
    }
    const cursor = cursors.externalBlocks.getCursor(blockContentId)
    return this._decodeData(contentBlock, cursor)
  }

  _decodeInt(contentBlock: CramFileBlock, cursor: Cursor) {
    const [result, bytesRead] = parseItf8(
      contentBlock.content,
      cursor.bytePosition,
    )
    cursor.bytePosition = cursor.bytePosition + bytesRead
    return result
  }

  _decodeByte(contentBlock: CramFileBlock, cursor: Cursor) {
    if (cursor.bytePosition >= contentBlock.content.length) {
      throw new CramBufferOverrunError(
        'attempted to read beyond end of block. this file seems truncated.',
      )
    }
    return contentBlock.content[cursor.bytePosition++]
  }
}
