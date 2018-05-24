const { getCodecClassWithId } = require('../codecs')

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
  IN: 'byte_array',
  SC: 'byte_array',
  DL: 'int',
  BA: 'byte',
  BB: 'byte_array',
  RS: 'int',
  PD: 'int',
  HC: 'int',
  MQ: 'int',
  RN: 'byte_array_block',
  QS: 'byte',
  QQ: 'byte_array',
  TL: 'int',
  TM: 'ignore',
  TV: 'ignore',
}

function parseSubstitutionMatrix(byteArray) {
  const matrix = new Array(5)
  for (let i = 0; i < 5; i += 1) matrix[i] = new Array(4)

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

class CramContainerCompressionScheme {
  constructor(content) {
    Object.assign(this, content)
    // interpret some of the preservation map tags for convenient use
    this.readNamesIncluded = content.preservation.RN
    this.APdelta = content.preservation.AP
    this.referenceRequired = content.preservation.RR
    this.tagIdsDictionary = content.preservation.TD
    this.substitutionMatrix = parseSubstitutionMatrix(content.preservation.SM)

    this.codecCache = {}
  }

  /**
   *
   * @param {string} tagName three-character tag name
   */
  getCodecForTag(tagName) {
    // NOT SURE THIS IS RIGHT
    return this.content.tagEncoding[tagName]
  }

  /**
   *
   * @param {number} tagListId ID of the tag list to fetch from the tag dictionary
   */
  getTagNames(tagListId) {
    return this.tagIdsDictionary[tagListId]
  }

  getCodecForDataSeries(dataSeriesName) {
    if (!this.codecCache[dataSeriesName]) {
      const encodingData = this.dataSeriesEncoding[dataSeriesName]
      if (encodingData) {
        const dataType = dataSeriesTypes[dataSeriesName]
        if (!dataType)
          throw new Error(`unknown data series name ${dataSeriesName}`)

        const CodecClass = getCodecClassWithId(
          dataType === 'ignore' ? 0 : encodingData.codecId,
        )

        this.codecCache[dataSeriesName] = new CodecClass(
          encodingData.parameters,
          dataType,
        )
      }
    }
    return this.codecCache[dataSeriesName]
  }
}

module.exports = CramContainerCompressionScheme
