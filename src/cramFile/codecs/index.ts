import CramCodec from './_base.ts'
import BetaCodec from './beta.ts'
import ByteArrayLengthCodec from './byteArrayLength.ts'
import ByteArrayStopCodec from './byteArrayStop.ts'
import { DataType } from './dataSeriesTypes.ts'
import ExternalCodec from './external.ts'
import GammaCodec from './gamma.ts'
import HuffmanIntCodec from './huffman.ts'
import SubexpCodec from './subexp.ts'
import { CramUnimplementedError } from '../../errors.ts'
import { CramEncoding } from '../encoding.ts'

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
