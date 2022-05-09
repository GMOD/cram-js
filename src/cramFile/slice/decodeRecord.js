import Long from 'long'
import { CramMalformedError } from '../../errors'
import CramRecord from '../record'
import Constants from '../constants'
/**
 * given a Buffer, read a string up to the first null character
 * @private
 */
function readNullTerminatedString(buffer) {
  let r = ''
  for (let i = 0; i < buffer.length && buffer[i] !== 0; i++) {
    r += String.fromCharCode(buffer[i])
  }
  return r
}

/**
 * parse a BAM tag's array value from a binary buffer
 * @private
 */
function parseTagValueArray(buffer) {
  const arrayType = String.fromCharCode(buffer[0])
  const length = Int32Array.from(buffer.slice(1))[0]

  const array = new Array(length)
  buffer = buffer.slice(5)

  if (arrayType === 'c') {
    const arr = new Int8Array(buffer.buffer)
    for (let i = 0; i < length; i += 1) {
      array[i] = arr[i]
    }
  } else if (arrayType === 'C') {
    const arr = new Uint8Array(buffer.buffer)
    for (let i = 0; i < length; i += 1) {
      array[i] = arr[i]
    }
  } else if (arrayType === 's') {
    const arr = new Int16Array(buffer.buffer)
    for (let i = 0; i < length; i += 1) {
      array[i] = arr[i]
    }
  } else if (arrayType === 'S') {
    const arr = new Uint16Array(buffer.buffer)
    for (let i = 0; i < length; i += 1) {
      array[i] = arr[i]
    }
  } else if (arrayType === 'i') {
    const arr = new Int32Array(buffer.buffer)
    for (let i = 0; i < length; i += 1) {
      array[i] = arr[i]
    }
  } else if (arrayType === 'I') {
    const arr = new Uint32Array(buffer.buffer)
    for (let i = 0; i < length; i += 1) {
      array[i] = arr[i]
    }
  } else if (arrayType === 'f') {
    const arr = new Float32Array(buffer.buffer)
    for (let i = 0; i < length; i += 1) {
      array[i] = arr[i]
    }
  } else {
    throw new Error('unknown type: ' + arrayType)
  }

  return array
}
function parseTagData(tagType, buffer) {
  if (tagType === 'Z') {
    return readNullTerminatedString(buffer)
  }
  if (tagType === 'A') {
    return String.fromCharCode(buffer[0])
  }
  if (tagType === 'I') {
    return Long.fromBytesLE(buffer).toNumber()
  }
  if (tagType === 'i') {
    return new Int32Array(buffer.buffer)[0]
  }
  if (tagType === 's') {
    return new Int16Array(buffer.buffer)[0]
  }
  if (tagType === 'S') {
    return new Uint16Array(buffer.buffer)[0]
  }
  if (tagType === 'c') {
    return new Int8Array(buffer.buffer)[0]
  }
  if (tagType === 'C') {
    return buffer[0]
  }
  if (tagType === 'f') {
    return new Float32Array(buffer.buffer)[0]
  }
  if (tagType === 'H') {
    return Number.parseInt(
      readNullTerminatedString(buffer).replace(/^0x/, ''),
      16,
    )
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
    cramRecord.readName = readNullTerminatedString(decodeDataSeries('RN'))
  }

  // mate record
  if (cramRecord.isDetached()) {
    // note: the MF is a byte in 1.0, int32 in 2+, but once again this doesn't matter for javascript
    const mate = {}
    mate.flags = decodeDataSeries('MF')
    if (!compressionScheme.readNamesIncluded) {
      mate.readName = readNullTerminatedString(decodeDataSeries('RN'))
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
        `${
          cramRecord.readName ||
          `${cramRecord.sequenceId}:${cramRecord.alignmentStart}`
        } record has invalid read features`,
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
