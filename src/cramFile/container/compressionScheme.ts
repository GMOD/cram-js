import { instantiateCodec } from '../codecs'
import CramCodec from '../codecs/_base'
import { CramCompressionHeader, CramPreservationMap } from '../sectionParsers'
import { CramEncoding } from '../encoding'
import { CramMalformedError } from '../../errors'
import {
  DataSeriesEncodingKey,
  DataSeriesEncodingMap,
} from '../codecs/dataSeriesTypes'
import { Int32 } from '../../branding'

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

export type DataSeriesTypes = typeof dataSeriesTypes

function parseSubstitutionMatrix(byteArray: number[]) {
  const matrix: string[][] = new Array(5)
  for (let i = 0; i < 5; i += 1) {
    matrix[i] = new Array(4)
  }

  matrix[0][(byteArray[0] >> 6) & 3] = 'C'
  matrix[0][(byteArray[0] >> 4) & 3] = 'G'
  matrix[0][(byteArray[0] >> 2) & 3] = 'T'
  matrix[0][(byteArray[0] >> 0) & 3] = 'N'

  matrix[1][(byteArray[1] >> 6) & 3] = 'A'
  matrix[1][(byteArray[1] >> 4) & 3] = 'G'
  matrix[1][(byteArray[1] >> 2) & 3] = 'T'
  matrix[1][(byteArray[1] >> 0) & 3] = 'N'

  matrix[2][(byteArray[2] >> 6) & 3] = 'A'
  matrix[2][(byteArray[2] >> 4) & 3] = 'C'
  matrix[2][(byteArray[2] >> 2) & 3] = 'T'
  matrix[2][(byteArray[2] >> 0) & 3] = 'N'

  matrix[3][(byteArray[3] >> 6) & 3] = 'A'
  matrix[3][(byteArray[3] >> 4) & 3] = 'C'
  matrix[3][(byteArray[3] >> 2) & 3] = 'G'
  matrix[3][(byteArray[3] >> 0) & 3] = 'N'

  matrix[4][(byteArray[4] >> 6) & 3] = 'A'
  matrix[4][(byteArray[4] >> 4) & 3] = 'C'
  matrix[4][(byteArray[4] >> 2) & 3] = 'G'
  matrix[4][(byteArray[4] >> 0) & 3] = 'T'

  return matrix
}

type DataSeriesCache = {
  [K in DataSeriesEncodingKey]?: CramCodec<DataSeriesTypes[K]>
}

export default class CramContainerCompressionScheme {
  public readNamesIncluded: boolean
  public APdelta: boolean
  public referenceRequired: boolean
  public tagIdsDictionary: Record<Int32, string[]>
  public substitutionMatrix: string[][]
  public dataSeriesCodecCache: DataSeriesCache = {}
  public tagCodecCache: Record<string, CramCodec> = {}
  public tagEncoding: Record<string, CramEncoding> = {}
  public dataSeriesEncoding: DataSeriesEncodingMap
  private preservation: CramPreservationMap
  private _endPosition: number
  private _size: number

  constructor(content: CramCompressionHeader) {
    // Object.assign(this, content)
    // interpret some of the preservation map tags for convenient use
    this.readNamesIncluded = content.preservation.RN
    this.APdelta = content.preservation.AP
    this.referenceRequired = !!content.preservation.RR
    this.tagIdsDictionary = content.preservation.TD
    this.substitutionMatrix = parseSubstitutionMatrix(content.preservation.SM)
    this.dataSeriesEncoding = content.dataSeriesEncoding
    this.tagEncoding = content.tagEncoding
    this.preservation = content.preservation
    this._size = content._size
    this._endPosition = content._endPosition
  }

  /**
   * @param {string} tagName three-character tag name
   * @private
   */
  getCodecForTag(tagName: string): CramCodec {
    if (!this.tagCodecCache[tagName]) {
      const encodingData = this.tagEncoding[tagName]
      if (encodingData) {
        this.tagCodecCache[tagName] = instantiateCodec(
          encodingData,
          'byteArray', // all tags are byte array data
        )
      }
    }
    return this.tagCodecCache[tagName]
  }

  /**
   *
   * @param {number} tagListId ID of the tag list to fetch from the tag dictionary
   * @private
   */
  getTagNames(tagListId: Int32) {
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
        const dataType = dataSeriesTypes[dataSeriesName]
        if (!dataType) {
          throw new CramMalformedError(
            `data series name ${dataSeriesName} not defined in file compression header`,
          )
        }
        r = instantiateCodec(encodingData, dataType)
        // didn't find a way to make TS understand this
        this.dataSeriesCodecCache[dataSeriesName] = r as CramCodec<any>
      }
    }
    return r
  }

  toJSON() {
    const data: any = {}
    Object.keys(this).forEach(k => {
      if (/Cache$/.test(k)) {
        return
      }
      data[k] = (this as any)[k]
    })
    return data
  }
}
