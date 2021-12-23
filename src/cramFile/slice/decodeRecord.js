import Long from 'long'
import { CramMalformedError, CramUnimplementedError } from '../../errors'
import CramRecord from '../record'
import Constants from '../constants'
/**
 * given a Buffer, read a string up to the first null character
 * @private
 */
function readNullTerminatedStringFromBuffer(buffer) {
  const zeroOffset = buffer.indexOf(0)
  if (zeroOffset === -1) {
    return buffer.toString('utf8')
  }
  return buffer.toString('utf8', 0, zeroOffset)
}

/**
 * parse a BAM tag's array value from a binary buffer
 * @private
 */
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
  if (!schema) {
    throw new CramMalformedError(`invalid tag value array type '${arrayType}'`)
  }

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
  if (!buffer.readInt32LE) {
    buffer = Buffer.from(buffer)
  }
  if (tagType === 'Z') {
    return readNullTerminatedStringFromBuffer(buffer)
  }
  if (tagType === 'A') {
    return String.fromCharCode(buffer[0])
  }
  if (tagType === 'I') {
    const val = Long.fromBytesLE(buffer)
    if (
      val.greaterThan(Number.MAX_SAFE_INTEGER) ||
      val.lessThan(Number.MIN_SAFE_INTEGER)
    ) {
      throw new CramUnimplementedError('integer overflow')
    }
    return val.toNumber()
  }
  if (tagType === 'i') {
    return buffer.readInt32LE(0)
  }
  if (tagType === 's') {
    return buffer.readInt16LE(0)
  }
  if (tagType === 'S') {
    return buffer.readUInt16LE(0)
  }
  if (tagType === 'c') {
    return buffer.readInt8(0)
  }
  if (tagType === 'C') {
    return buffer.readUInt8(0)
  }
  if (tagType === 'f') {
    return buffer.readFloatLE(0)
  }
  if (tagType === 'H') {
    const hex = readNullTerminatedStringFromBuffer(buffer)
    return Number.parseInt(hex.replace(/^0x/, ''), 16)
  }
  if (tagType === 'B') {
    return parseTagValueArray(buffer)
  }

  throw new CramMalformedError(`Unrecognized tag type ${tagType}`)
}

function decodeReadFeatures(
  cramRecord,
  readFeatureCount,
  decodeDataSeries,
  compressionScheme,
  majorVersion,
) {
  let currentReadPos = 0
  let currentRefPos = cramRecord.alignmentStart - 1
  const readFeatures = new Array(readFeatureCount)

  function decodeRFData([type, dataSeriesName]) {
    const data = decodeDataSeries(dataSeriesName)
    if (type === 'character') {
      return String.fromCharCode(data)
    }
    if (type === 'string') {
      return data.toString('utf8')
    }
    if (type === 'numArray') {
      return data.toArray()
    }
    // else if (type === 'number') {
    //   return data[0]
    // }
    return data
  }

  for (let i = 0; i < readFeatureCount; i += 1) {
    const code = String.fromCharCode(decodeDataSeries('FC'))

    const readPosDelta = decodeDataSeries('FP')

    const readFeature = { code }
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
    }[code]

    if (!data1Schema) {
      throw new CramMalformedError(`invalid read feature code "${code}"`)
    }

    readFeature.data = decodeRFData(data1Schema)

    // if this is a tag with two data items, make the data an array and add the second item
    const data2Schema = { B: ['number', 'QS'] }[code]
    if (data2Schema) {
      readFeature.data = [readFeature.data, decodeRFData(data2Schema)]
    }

    currentReadPos += readPosDelta
    readFeature.pos = currentReadPos

    currentRefPos += readPosDelta
    readFeature.refPos = currentRefPos

    // for gapping features, adjust the reference position for read features that follow
    if (code === 'D' || code === 'N') {
      currentRefPos += readFeature.data
    } else if (code === 'I' || code === 'S') {
      currentRefPos -= readFeature.data.length
    } else if (code === 'i') {
      currentRefPos -= 1
    }

    readFeatures[i] = readFeature
  }
  return readFeatures
}

function thingToString(thing) {
  if (thing instanceof Buffer) {
    return readNullTerminatedStringFromBuffer(thing)
  }
  if (thing.length && thing.indexOf) {
    // array-like
    if (!thing[thing.length - 1]) {
      // trim zeroes off the end if necessary
      const termIndex = thing.indexOf(0)
      return String.fromCharCode(...thing.slice(0, termIndex))
    }
    return String.fromCharCode(...thing)
  }
  return String(thing)
}

export default function decodeRecord(
  slice,
  decodeDataSeries,
  compressionScheme,
  sliceHeader,
  coreDataBlock,
  blocksByContentId,
  cursors,
  majorVersion,
  recordNumber,
) {
  const cramRecord = new CramRecord()

  cramRecord.flags = decodeDataSeries('BF')

  // note: the C data type of compressionFlags is byte in cram v1
  // and int32 in cram v2+, but that does not matter for us here
  // in javascript land.
  cramRecord.cramFlags = decodeDataSeries('CF')

  if (majorVersion > 1 && sliceHeader.content.refSeqId === -2) {
    cramRecord.sequenceId = decodeDataSeries('RI')
  } else {
    cramRecord.sequenceId = sliceHeader.content.refSeqId
  }

  cramRecord.readLength = decodeDataSeries('RL')
  // if APDelta, will calculate the true start in a second pass
  cramRecord.alignmentStart = decodeDataSeries('AP')
  if (compressionScheme.APdelta) {
    cramRecord.alignmentStart += cursors.lastAlignmentStart
  }
  cursors.lastAlignmentStart = cramRecord.alignmentStart
  cramRecord.readGroupId = decodeDataSeries('RG')

  if (compressionScheme.readNamesIncluded) {
    cramRecord.readName = thingToString(decodeDataSeries('RN'))
  }

  // mate record
  if (cramRecord.isDetached()) {
    // note: the MF is a byte in 1.0, int32 in 2+, but once again this doesn't matter for javascript
    const mate = {}
    mate.flags = decodeDataSeries('MF')
    if (!compressionScheme.readNamesIncluded) {
      mate.readName = thingToString(decodeDataSeries('RN'))
      cramRecord.readName = mate.readName
    }
    mate.sequenceId = decodeDataSeries('NS')
    mate.alignmentStart = decodeDataSeries('NP')
    if (mate.flags || mate.sequenceId > -1) {
      cramRecord.mate = mate
    }
    cramRecord.templateSize = decodeDataSeries('TS')

    // set mate unmapped if needed
    if (mate.flags & Constants.CRAM_M_UNMAP) {
      cramRecord.flags |= Constants.BAM_FMUNMAP
    }
    // set mate reversed if needed
    if (mate.flags & Constants.CRAM_M_REVERSE) {
      cramRecord.flags |= Constants.BAM_FMREVERSE
    }

    // detachedCount++
  } else if (cramRecord.hasMateDownStream()) {
    cramRecord.mateRecordNumber = decodeDataSeries('NF') + recordNumber + 1
  }

  // TODO: the aux tag parsing will have to be refactored if we want to support
  // cram v1
  const TLindex = decodeDataSeries('TL')
  if (TLindex < 0) {
    /* TODO: check nTL: TLindex >= compressionHeader.tagEncoding.size */
    throw new CramMalformedError('invalid TL index')
  }

  // TN = tag names
  const TN = compressionScheme.getTagNames(TLindex)
  const ntags = TN.length

  for (let i = 0; i < ntags; i += 1) {
    const tagId = TN[i]
    const tagName = tagId.substr(0, 2)
    const tagType = tagId.substr(2, 1)

    const tagCodec = compressionScheme.getCodecForTag(tagId)
    if (!tagCodec) {
      throw new CramMalformedError(
        `no codec defined for auxiliary tag ${tagId}`,
      )
    }
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
        cramRecord,
        readFeatureCount,
        decodeDataSeries,
        compressionScheme,
        majorVersion,
      )
    }

    // compute the read's true span on the reference sequence, and the end coordinate of the alignment on the reference
    let lengthOnRef = cramRecord.readLength
    if (cramRecord.readFeatures) {
      cramRecord.readFeatures.forEach(({ code, data }) => {
        if (code === 'D' || code === 'N') {
          lengthOnRef += data
        } else if (code === 'I' || code === 'S') {
          lengthOnRef -= data.length
        } else if (code === 'i') {
          lengthOnRef -= 1
        }
      })
    }
    if (Number.isNaN(lengthOnRef)) {
      console.warn(
        `${cramRecord.readName ||
          `${cramRecord.sequenceId}:${cramRecord.alignmentStart}`} record has invalid read features`,
      )
      lengthOnRef = cramRecord.readLength
    }
    cramRecord.lengthOnRef = lengthOnRef

    // mapping quality
    cramRecord.mappingQuality = decodeDataSeries('MQ')
    if (cramRecord.isPreservingQualityScores()) {
      const bases = new Array(cramRecord.readLength)
      for (let i = 0; i < bases.length; i += 1) {
        bases[i] = decodeDataSeries('QS')
      }
      cramRecord.qualityScores = bases
    }
  } else if (cramRecord.isUnknownBases()) {
    cramRecord.readBases = null
    cramRecord.qualityScores = null
  } else {
    const bases = new Array(cramRecord.readLength)
    for (let i = 0; i < bases.length; i += 1) {
      bases[i] = decodeDataSeries('BA')
    }
    cramRecord.readBases = String.fromCharCode(...bases)

    if (cramRecord.isPreservingQualityScores()) {
      for (let i = 0; i < bases.length; i += 1) {
        bases[i] = decodeDataSeries('QS')
      }

      cramRecord.qualityScores = bases
    }
  }

  return cramRecord
}
