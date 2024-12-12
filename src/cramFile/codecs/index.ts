import CramCodec from './_base'
import BetaCodec from './beta'
import ByteArrayLengthCodec from './byteArrayLength'
import ByteArrayStopCodec from './byteArrayStop'
import { DataType } from './dataSeriesTypes'
import ExternalCodec from './external'
import GammaCodec from './gamma'
import HuffmanIntCodec from './huffman'
import SubexpCodec from './subexp'
import { CramUnimplementedError } from '../../errors'
import { CramEncoding } from '../encoding'

const codecClasses = {
  1: ExternalCodec,
  // 2: GolombCodec,
  3: HuffmanIntCodec,
  4: ByteArrayLengthCodec,
  5: ByteArrayStopCodec,
  6: BetaCodec,
  7: SubexpCodec,
  // 8: GolombRiceCodec,
  9: GammaCodec,
}

function getCodecClassWithId(id: number) {
  return (codecClasses as any)[id]
}

export function instantiateCodec<TResult extends DataType = DataType>(
  encodingData: CramEncoding,
  dataType: DataType | 'ignore',
): CramCodec<TResult> {
  const CodecClass = getCodecClassWithId(
    dataType === 'ignore' ? 0 : encodingData.codecId,
  )
  if (!CodecClass) {
    throw new CramUnimplementedError(
      `no codec implemented for codec ID ${encodingData.codecId}`,
    )
  }

  return new CodecClass(encodingData.parameters, dataType, instantiateCodec)
}
