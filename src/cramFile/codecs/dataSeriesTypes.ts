import type { CramEncoding } from '../encoding.ts'

export type DataType = 'int' | 'byte' | 'long' | 'byteArray'

export type DataSeriesEncodingKey =
  | 'BF'
  | 'CF'
  | 'RI'
  | 'RL'
  | 'AP'
  | 'RG'
  | 'RN'
  | 'MF'
  | 'NS'
  | 'NP'
  | 'TS'
  | 'NF'
  | 'TL'
  | 'FN'
  | 'FC'
  | 'FP'
  | 'DL'
  | 'BB'
  | 'QQ'
  | 'BS'
  | 'IN'
  | 'RS'
  | 'PD'
  | 'HC'
  | 'SC'
  | 'MQ'
  | 'BA'
  | 'QS'
  | 'TC'
  | 'TN'
// | 'TM'
// | 'TV'

// Partial because a given CRAM file's compression header only includes
// encodings for the data series it actually uses
export type DataSeriesEncodingMap = Partial<
  Record<DataSeriesEncodingKey, CramEncoding>
>
