import type { CramEncoding } from '../encoding.ts'

export type DataType = 'int' | 'byte' | 'long' | 'byteArray'

/**
 * The data type each core data series decodes to, per CRAMv3 §8.4.
 *
 * This is the list of data series, and the type of each — one table rather than
 * the two it used to be. `DataSeriesEncodingKey` was a hand-written union of the
 * same thirty names, in this file, next to a `dataSeriesTypes` map of name to
 * type in `container/compressionScheme.ts`; a series added to one and not the
 * other is a silent gap, since neither is derived from the other. The union is
 * `keyof typeof` this now.
 */
export const dataSeriesTypes = {
  BF: 'int',
  CF: 'int',
  RI: 'int',
  RL: 'int',
  AP: 'int',
  RG: 'int',
  MF: 'int',
  NS: 'int',
  NP: 'int',
  TS: 'int',
  NF: 'int',
  TC: 'byte',
  TN: 'int',
  FN: 'int',
  FC: 'byte',
  FP: 'int',
  BS: 'byte',
  IN: 'byteArray',
  SC: 'byteArray',
  DL: 'int',
  BA: 'byte',
  BB: 'byteArray',
  RS: 'int',
  PD: 'int',
  HC: 'int',
  MQ: 'int',
  RN: 'byteArray',
  QS: 'byte',
  QQ: 'byteArray',
  TL: 'int',
  // TM: 'ignore',
  // TV: 'ignore',
} as const

export type DataSeriesTypes = typeof dataSeriesTypes

export type DataSeriesEncodingKey = keyof DataSeriesTypes

// Partial because a given CRAM file's compression header only includes
// encodings for the data series it actually uses
export type DataSeriesEncodingMap = Partial<
  Record<DataSeriesEncodingKey, CramEncoding>
>
