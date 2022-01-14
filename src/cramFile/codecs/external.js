import {
  CramUnimplementedError,
  CramMalformedError,
  CramBufferOverrunError,
} from '../../errors'
import CramCodec from './_base'
import { parseItf8 } from '../util'

export default class ExternalCodec extends CramCodec {
  constructor(parameters = {}, dataType) {
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

  decode(slice, coreDataBlock, blocksByContentId, cursors) {
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

  _decodeInt(contentBlock, cursor) {
    const [result, bytesRead] = parseItf8(
      contentBlock.content,
      cursor.bytePosition,
    )
    cursor.bytePosition += bytesRead
    return result
  }

  _decodeByte(contentBlock, cursor) {
    if (cursor.bytePosition >= contentBlock.content.length) {
      throw new CramBufferOverrunError(
        'attempted to read beyond end of block. this file seems truncated.',
      )
    }
    const result = contentBlock.content[cursor.bytePosition]
    cursor.bytePosition += 1
    return result
  }
}
