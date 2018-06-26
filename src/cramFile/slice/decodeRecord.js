const { CramMalformedError, CramUnimplementedError } = require('../../errors')

const Long = require('long')
const Constants = require('../constants')

class CramRecord {
  constructor() {
    this.tags = {}
  }
  isDetached() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_DETACHED)
  }

  hasMateDownStream() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_MATE_DOWNSTREAM)
  }

  isSegmentUnmapped() {
    return !!(this.flags & Constants.BAM_FUNMAP)
  }

  isPreservingQualityScores() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_PRESERVE_QUAL_SCORES)
  }

  isUnknownBases() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_NO_SEQ)
  }
}

/** given a Buffer, read a string up to the first null character */
function readNullTerminatedStringFromBuffer(buffer) {
  const zeroOffset = buffer.indexOf(0)
  if (zeroOffset === -1) return buffer.toString('utf8')
  return buffer.toString('utf8', 0, zeroOffset)
}

/** parse a BAM tag's array value from a binary buffer */
function parseTagValueArray(buffer) {
  const arrayType = String.fromCharCode(buffer[0])
  const length = buffer.readInt32LE(1)

  const schema = {
    c: ['readInt8', 1],
    C: ['readUInt8', 1],
    s: ['readInt16LE', 2],
    S: ['readUInt16LE', 2],
    i: ['readInt32LE', 4],
    I: ['readUInt32LE', 4],
    f: ['readFloatLE', 4],
  }[arrayType]
  if (!schema)
    throw new CramMalformedError(`invalid tag value array type '${arrayType}'`)

  const [getMethod, itemSize] = schema
  const array = new Array(length)
  let offset = 5
  for (let i = 0; i < length; i += 1) {
    array[i] = buffer[getMethod](offset)
    offset += itemSize
  }
  return array
}

function parseTagData(tagType, buffer) {
  if (!buffer.readInt32LE) buffer = Buffer.from(buffer)
  if (tagType === 'Z') return readNullTerminatedStringFromBuffer(buffer)
  else if (tagType === 'A') return String.fromCharCode(buffer[0])
  else if (tagType === 'I') {
    const val = Long.fromBytesLE(buffer)
    if (
      val.greaterThan(Number.MAX_SAFE_INTEGER) ||
      val.lessThan(Number.MIN_SAFE_INTEGER)
    )
      throw new CramUnimplementedError('integer overflow')
    return val.toNumber()
  } else if (tagType === 'i') return buffer.readInt32LE(0)
  else if (tagType === 's') return buffer.readInt16LE(0)
  else if (tagType === 'S') return buffer.readUInt16LE(0)
  else if (tagType === 'c') return buffer.readInt8(0)
  else if (tagType === 'C') return buffer.readUInt8(0)
  else if (tagType === 'f') return buffer.readFloatLE(0)
  if (tagType === 'H') {
    const hex = readNullTerminatedStringFromBuffer(buffer)
    return Number.parseInt(hex.replace(/^0x/, ''), 16)
  }
  if (tagType === 'B') return parseTagValueArray(buffer)

  throw new CramMalformedError(`Unrecognized tag type ${tagType}`)
}

function decodeReadFeatures(readFeatureCount, decodeDataSeries, majorVersion) {
  let prevPos = 0
  const readFeatures = new Array(readFeatureCount)

  function decodeRFData([type, dataSeriesName]) {
    const data = decodeDataSeries(dataSeriesName)
    if (type === 'character') {
      return String.fromCharCode(data)
    } else if (type === 'string') {
      return data.toString('utf8')
    } else if (type === 'numArray') {
      return data.toArray()
    }
    // else if (type === 'number') {
    //   return data[0]
    // }
    return data
  }

  for (let i = 0; i < readFeatureCount; i += 1) {
    const operator = String.fromCharCode(decodeDataSeries('FC'))

    const position = prevPos + decodeDataSeries('FP')
    prevPos = position

    const readFeature = { operator, position }
    // map of operator name -> data series name
    const data1Schema = {
      B: ['character', 'BA'],
      S: ['string', majorVersion > 1 ? 'SC' : 'IN'], // IN if cram v1, SC otherwise
      X: ['number', 'BS'],
      D: ['number', 'DL'],
      I: ['string', 'IN'],
      i: ['character', 'BA'],
      b: ['string', 'BB'],
      q: ['numArray', 'QQ'],
      Q: ['number', 'QS'],
      H: ['number', 'HC'],
      P: ['number', 'PD'],
      N: ['number', 'RS'],
    }[operator]

    if (!data1Schema)
      throw new CramMalformedError(
        `invalid read feature operator "${operator}"`,
      )

    readFeature.data = decodeRFData(data1Schema)

    // if this is a tag with two data items, make the data an array and add the second item
    const data2Schema = { B: ['number', 'QS'] }[operator]
    if (data2Schema)
      readFeature.data = [readFeature.data, decodeRFData(data2Schema)]

    readFeatures[i] = readFeature
  }
  return readFeatures
}

function decodeRecord(
  slice,
  decodeDataSeries,
  compressionScheme,
  sliceHeader,
  coreDataBlock,
  blocksByContentId,
  cursors,
  majorVersion,
) {
  const cramRecord = new CramRecord()

  cramRecord.flags = decodeDataSeries('BF')

  // note: the C data type of compressionFlags is byte in cram v1
  // and int32 in cram v2+, but that does not matter for us here
  // in javascript land.
  cramRecord.compressionFlags = decodeDataSeries('CF')

  if (majorVersion > 1 && sliceHeader.content.refSeqId === -2)
    cramRecord.sequenceId = decodeDataSeries('RI')
  else cramRecord.sequenceId = sliceHeader.content.refSeqId

  cramRecord.readLength = decodeDataSeries('RL')
  // if APDelta, will calculate the true start in a second pass
  cramRecord.alignmentStart = decodeDataSeries('AP')
  cramRecord.readGroupId = decodeDataSeries('RG')

  if (compressionScheme.readNamesIncluded)
    cramRecord.readName = decodeDataSeries('RN').toString('utf8') // new String(readNameCodec.readData(), charset)

  // mate record
  if (cramRecord.isDetached()) {
    // note: the MF is a byte in 1.0, int32 in 2+, but once again this doesn't matter for javascript
    cramRecord.mateFlags = decodeDataSeries('MF')
    cramRecord.mate = {}
    if (!compressionScheme.readNamesIncluded)
      cramRecord.mate.readName = decodeDataSeries('RN') // new String(readNameCodec.readData(), charset)
    cramRecord.mate.sequenceID = decodeDataSeries('NS')
    cramRecord.mate.alignmentStart = decodeDataSeries('NP')
    cramRecord.templateSize = decodeDataSeries('TS')
    // detachedCount++
  } else if (cramRecord.hasMateDownStream()) {
    cramRecord.recordsToNextFragment = decodeDataSeries('NF')
  }

  // TODO: the aux tag parsing will have to be refactored if we want to support
  // cram v1
  const TLindex = decodeDataSeries('TL')
  if (TLindex < 0)
    /* TODO: check nTL: TLindex >= compressionHeader.tagEncoding.size */
    throw new CramMalformedError('invalid TL index')

  // TN = tag names
  const TN = compressionScheme.getTagNames(TLindex)
  const ntags = TN.length

  for (let i = 0; i < ntags; i += 1) {
    const tagId = TN[i]
    const tagName = tagId.substr(0, 2)
    const tagType = tagId.substr(2, 1)

    const tagCodec = compressionScheme.getCodecForTag(tagId)
    if (!tagCodec)
      throw new CramMalformedError(
        `no codec defined for auxiliary tag ${tagId}`,
      )
    const tagData = tagCodec.decode(
      slice,
      coreDataBlock,
      blocksByContentId,
      cursors,
    )
    cramRecord.tags[tagName] = parseTagData(tagType, tagData)
  }

  if (!cramRecord.isSegmentUnmapped()) {
    // reading read features
    const /* int */ readFeatureCount = decodeDataSeries('FN')
    if (readFeatureCount) {
      cramRecord.readFeatures = decodeReadFeatures(
        readFeatureCount,
        decodeDataSeries,
        majorVersion,
      )
    }

    // mapping quality:
    cramRecord.mappingQuality = decodeDataSeries('MQ')
    if (cramRecord.isPreservingQualityScores()) {
      cramRecord.qualityScores = decodeDataSeries('QS')
    }
  } else if (cramRecord.isUnknownBases()) {
    cramRecord.readBases = null
    cramRecord.qualityScores = null
  } else {
    const /* byte[] */ bases = new Array(
      cramRecord.readLength,
    ) /* new byte[cramRecord.readLength]; */
    for (let i = 0; i < bases.length; i += 1) bases[i] = decodeDataSeries('BA')
    cramRecord.readBases = String.fromCharCode(...bases)

    if (cramRecord.isPreservingQualityScores()) {
      cramRecord.qualityScores = decodeDataSeries('QS')
    }
  }

  // recordCounter++

  // prevRecord = cramRecord

  return cramRecord
}

module.exports = decodeRecord
