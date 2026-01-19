import CramCodec, { Cursors } from './_base.ts'
import { CramUnimplementedError } from '../../errors.ts'
import { CramFileBlock } from '../file.ts'
import CramSlice from '../slice/index.ts'
import { parseItf8 } from '../util.ts'
import { CramBufferOverrunError } from './getBits.ts'
import { ExternalCramEncoding } from '../encoding.ts'

export default class ExternalCodec extends CramCodec<
  'int' | 'byte',
  ExternalCramEncoding['parameters']
> {
  constructor(
    parameters: ExternalCramEncoding['parameters'],
    dataType: 'int' | 'byte',
  ) {
    super(parameters, dataType)
    if (this.dataType !== 'int' && this.dataType !== 'byte') {
      throw new CramUnimplementedError(
        `${this.dataType} decoding not yet implemented by EXTERNAL codec`,
      )
    }
  }

  decode(
    _slice: CramSlice,
    _coreDataBlock: CramFileBlock,
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
  ) {
    const { blockContentId } = this.parameters
    const contentBlock = blocksByContentId[blockContentId]
    if (!contentBlock) {
      return undefined
    }

    const cursor = cursors.externalBlocks.getCursor(blockContentId)

    if (this.dataType === 'int') {
      const [result, bytesRead] = parseItf8(
        contentBlock.content,
        cursor.bytePosition,
      )
      cursor.bytePosition += bytesRead
      return result
    } else {
      if (cursor.bytePosition >= contentBlock.content.length) {
        throw new CramBufferOverrunError(
          'attempted to read beyond end of block. this file seems truncated.',
        )
      }
      return contentBlock.content[cursor.bytePosition++]!
    }
  }

  getBytesAsNumberArray(
    blocksByContentId: Record<number, CramFileBlock>,
    cursors: Cursors,
    length: number,
  ): number[] {
    const { blockContentId } = this.parameters
    const contentBlock = blocksByContentId[blockContentId]
    if (!contentBlock) {
      return []
    }

    const cursor = cursors.externalBlocks.getCursor(blockContentId)
    const start = cursor.bytePosition
    const end = start + length

    if (end > contentBlock.content.length) {
      throw new CramBufferOverrunError(
        'attempted to read beyond end of block. this file seems truncated.',
      )
    }

    cursor.bytePosition = end
    return Array.from(contentBlock.content.subarray(start, end))
  }
}
