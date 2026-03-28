import BetaCodec from './beta.ts'
import ByteArrayLengthCodec from './byteArrayLength.ts'
import ByteArrayStopCodec from './byteArrayStop.ts'
import ExternalCodec from './external.ts'
import GammaCodec from './gamma.ts'
import HuffmanIntCodec from './huffman.ts'
import SubexpCodec from './subexp.ts'
import { CramUnimplementedError } from '../../errors.ts'

import type CramCodec from './_base.ts'
import type { DataType } from './dataSeriesTypes.ts'
import type { CramEncoding } from '../encoding.ts'

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

type CramCodecFactory = <TData extends DataType = DataType>(
  encodingData: CramEncoding,
  dataType: TData | 'ignore',
) => CramCodec<TData>

type CramCodecConstructor = new (
  parameters: unknown,
  dataType: DataType,
  factory: CramCodecFactory,
) => CramCodec

function getCodecClassWithId(id: number): CramCodecConstructor | undefined {
  return (codecClasses as Record<number, CramCodecConstructor | undefined>)[id]
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

  return new CodecClass(
    encodingData.parameters,
    dataType as DataType,
    instantiateCodec,
  ) as CramCodec<TResult>
}
