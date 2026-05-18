import { instantiateCodec } from '../codecs/index.ts'

import type CramCodec from '../codecs/_base.ts'
import type {
  DataSeriesEncodingKey,
  DataSeriesEncodingMap,
} from '../codecs/dataSeriesTypes.ts'
import type { CramEncoding } from '../encoding.ts'
import type { CramCompressionHeader } from '../sectionParsers.ts'

// the hardcoded data type to be decoded for each core
// data field
const dataSeriesTypes = {
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

export { dataSeriesTypes }
export type DataSeriesTypes = typeof dataSeriesTypes

// For each reference base index 0..4 (A,C,G,T,N), the three other bases plus N
// (or T for ref=N), in the order they're packed into the 2-bit substitution code
const SUBSTITUTIONS = [
  ['C', 'G', 'T', 'N'],
  ['A', 'G', 'T', 'N'],
  ['A', 'C', 'T', 'N'],
  ['A', 'C', 'G', 'N'],
  ['A', 'C', 'G', 'T'],
] as const

function parseSubstitutionMatrix(byteArray: number[]) {
  const matrix: string[][] = new Array(5)
  for (let i = 0; i < 5; i++) {
    const row = new Array<string>(4)
    const byte = byteArray[i]!
    const subs = SUBSTITUTIONS[i]!
    for (let j = 0; j < 4; j++) {
      row[(byte >> (6 - 2 * j)) & 3] = subs[j]!
    }
    matrix[i] = row
  }
  return matrix
}

type DataSeriesCache = {
  [K in DataSeriesEncodingKey]?: CramCodec<DataSeriesTypes[K]>
}

export default class CramContainerCompressionScheme {
  public readNamesIncluded: boolean
  public APdelta: boolean
  public referenceRequired: boolean
  public tagIdsDictionary: Record<number, string[]>
  public substitutionMatrix: string[][]
  public dataSeriesCodecCache: DataSeriesCache = {}
  public tagCodecCache: Record<string, CramCodec> = {}
  public tagEncoding: Record<string, CramEncoding> = {}
  public dataSeriesEncoding: DataSeriesEncodingMap

  constructor(content: CramCompressionHeader) {
    // interpret some of the preservation map tags for convenient use
    this.readNamesIncluded = content.preservation.RN
    this.APdelta = content.preservation.AP

    this.referenceRequired = !!content.preservation.RR
    this.tagIdsDictionary = content.preservation.TD
    this.substitutionMatrix = parseSubstitutionMatrix(content.preservation.SM)
    this.dataSeriesEncoding = content.dataSeriesEncoding
    this.tagEncoding = content.tagEncoding
  }

  /**
   * @param {string} tagName three-character tag name
   * @private
   */
  getCodecForTag(tagName: string): CramCodec {
    if (!this.tagCodecCache[tagName]) {
      const encodingData = this.tagEncoding[tagName]
      if (!encodingData) {
        throw new Error('Error, no tag encoding')
      }
      // all tags are byte array data
      this.tagCodecCache[tagName] = instantiateCodec(encodingData, 'byteArray')
    }
    return this.tagCodecCache[tagName]
  }

  /**
   *
   * @param {number} tagListId ID of the tag list to fetch from the tag dictionary
   * @private
   */
  getTagNames(tagListId: number) {
    return this.tagIdsDictionary[tagListId]
  }

  getCodecForDataSeries<TDataSeries extends DataSeriesEncodingKey>(
    dataSeriesName: TDataSeries,
  ): CramCodec<DataSeriesTypes[TDataSeries]> | undefined {
    let r: CramCodec<DataSeriesTypes[TDataSeries]> | undefined =
      this.dataSeriesCodecCache[dataSeriesName]
    if (r === undefined) {
      const encodingData = this.dataSeriesEncoding[dataSeriesName]
      if (encodingData) {
        r = instantiateCodec(encodingData, dataSeriesTypes[dataSeriesName])
        // TS can't unify the per-key cache value type with the generic
        // TDataSeries — store via an untyped slot.
        this.dataSeriesCodecCache[dataSeriesName] =
          r as DataSeriesCache[TDataSeries]
      }
    }
    return r
  }

  // Used implicitly by snapshot tests to keep the codec caches (which contain
  // class instances and are noisy/non-stable) out of the serialized form.
  toJSON() {
    const data: Record<string, unknown> = {}
    Object.keys(this).forEach(k => {
      if (k.endsWith('Cache')) {
        return
      }
      data[k] = (this as Record<string, unknown>)[k]
    })
    return data
  }
}
