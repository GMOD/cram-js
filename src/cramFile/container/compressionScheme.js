import { CramMalformedError } from '../../errors'
import { instantiateCodec } from '../codecs'

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
  TM: 'ignore',
  TV: 'ignore',
}

function parseSubstitutionMatrix(byteArray) {
  const matrix = new Array(5)
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

export default class CramContainerCompressionScheme {
  constructor(content) {
    Object.assign(this, content)
    // interpret some of the preservation map tags for convenient use
    this.readNamesIncluded = content.preservation.RN
    this.APdelta = content.preservation.AP
    this.referenceRequired = !!content.preservation.RR
    this.tagIdsDictionary = content.preservation.TD
    this.substitutionMatrix = parseSubstitutionMatrix(content.preservation.SM)

    this.dataSeriesCodecCache = new Map()
    this.tagCodecCache = {}
  }

  /**
   * @param {string} tagName three-character tag name
   * @private
   */
  getCodecForTag(tagName) {
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
  getTagNames(tagListId) {
    return this.tagIdsDictionary[tagListId]
  }

  getCodecForDataSeries(dataSeriesName) {
    let r = this.dataSeriesCodecCache.get(dataSeriesName)
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
        this.dataSeriesCodecCache.set(dataSeriesName, r)
      }
    }
    return r
  }
}
