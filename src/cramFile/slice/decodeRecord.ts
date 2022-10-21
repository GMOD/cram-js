import Long from 'long'
import { CramMalformedError } from '../../errors'
import {
  BamFlagsDecoder,
  CramFlagsDecoder,
  MateFlagsDecoder,
  ReadFeature,
} from '../record'
import CramSlice, { SliceHeader } from './index'
import { isMappedSliceHeader } from '../sectionParsers'
import CramContainerCompressionScheme, {
  DataSeriesTypes,
} from '../container/compressionScheme'
import { CramFileBlock } from '../file'
import { Cursors, DataTypeMapping } from '../codecs/_base'
import { DataSeriesEncodingKey } from '../codecs/dataSeriesTypes'
import { addInt32, assertInt32, Int8, subtractInt32 } from '../../branding'

/**
 * given a Buffer, read a string up to the first null character
 * @private
 */
function readNullTerminatedString(buffer: Uint8Array) {
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
function parseTagValueArray(buffer: Buffer) {
  const arrayType = String.fromCharCode(buffer[0])
  const length = Int32Array.from(buffer.slice(1))[0]

  const array: number[] = new Array(length)
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

function parseTagData(tagType: string, buffer: any) {
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
    return buffer[0] as number
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
  alignmentStart: number,
  readFeatureCount: number,
  decodeDataSeries: any,
  compressionScheme: CramContainerCompressionScheme,
  majorVersion: number,
) {
  let currentReadPos = 0
  let currentRefPos = alignmentStart - 1
  const readFeatures: ReadFeature[] = new Array(readFeatureCount)

  function decodeRFData([type, dataSeriesName]: readonly [
    type: string,
    dataSeriesName: string,
  ]) {
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

    // map of operator name -> data series name
    const data1Schema = {
      B: ['character', 'BA'] as const,
      S: ['string', majorVersion > 1 ? 'SC' : 'IN'] as const, // IN if cram v1, SC otherwise
      X: ['number', 'BS'] as const,
      D: ['number', 'DL'] as const,
      I: ['string', 'IN'] as const,
      i: ['character', 'BA'] as const,
      b: ['string', 'BB'] as const,
      q: ['numArray', 'QQ'] as const,
      Q: ['number', 'QS'] as const,
      H: ['number', 'HC'] as const,
      P: ['number', 'PD'] as const,
      N: ['number', 'RS'] as const,
    }[code]

    if (!data1Schema) {
      throw new CramMalformedError(`invalid read feature code "${code}"`)
    }

    let data = decodeRFData(data1Schema)

    // if this is a tag with two data items, make the data an array and add the second item
    const data2Schema = { B: ['number', 'QS'] as const }[code]
    if (data2Schema) {
      data = [data, decodeRFData(data2Schema)]
    }

    currentReadPos += readPosDelta
    const pos = currentReadPos

    currentRefPos += readPosDelta
    const refPos = currentRefPos

    // for gapping features, adjust the reference position for read features that follow
    if (code === 'D' || code === 'N') {
      currentRefPos += data
    } else if (code === 'I' || code === 'S') {
      currentRefPos -= data.length
    } else if (code === 'i') {
      currentRefPos -= 1
    }

    readFeatures[i] = { code, pos, refPos, data }
  }
  return readFeatures
}

export type DataSeriesDecoder = <T extends DataSeriesEncodingKey>(
  dataSeriesName: T,
) => DataTypeMapping[DataSeriesTypes[T]]

export default function decodeRecord(
  slice: CramSlice,
  decodeDataSeries: DataSeriesDecoder,
  compressionScheme: CramContainerCompressionScheme,
  sliceHeader: SliceHeader,
  coreDataBlock: CramFileBlock,
  blocksByContentId: Record<number, CramFileBlock>,
  cursors: Cursors,
  majorVersion: number,
  recordNumber: number,
) {
  let flags = decodeDataSeries('BF') as number

  // note: the C data type of compressionFlags is byte in cram v1
  // and int32 in cram v2+, but that does not matter for us here
  // in javascript land.
  const cramFlags = decodeDataSeries('CF') as number

  if (!isMappedSliceHeader(sliceHeader.parsedContent)) {
    throw new Error()
  }

  let sequenceId
  if (majorVersion > 1 && sliceHeader.parsedContent.refSeqId === -2) {
    sequenceId = decodeDataSeries('RI')
  } else {
    sequenceId = sliceHeader.parsedContent.refSeqId
  }

  const readLength = decodeDataSeries('RL')
  // if APDelta, will calculate the true start in a second pass
  let alignmentStart = decodeDataSeries('AP')
  if (compressionScheme.APdelta) {
    alignmentStart = addInt32(alignmentStart, cursors.lastAlignmentStart)
  }
  cursors.lastAlignmentStart = alignmentStart
  const readGroupId = decodeDataSeries('RG')

  let readName
  if (compressionScheme.readNamesIncluded) {
    readName = readNullTerminatedString(decodeDataSeries('RN'))
  }

  let mateToUse
  let templateSize
  let mateRecordNumber
  // mate record
  if (CramFlagsDecoder.isDetached(cramFlags)) {
    // note: the MF is a byte in 1.0, int32 in 2+, but once again this doesn't matter for javascript
    // const mate: any = {}
    const mateFlags = decodeDataSeries('MF') as number
    let mateReadName
    if (!compressionScheme.readNamesIncluded) {
      mateReadName = readNullTerminatedString(decodeDataSeries('RN'))
      readName = mateReadName
    }
    const mateSequenceId = decodeDataSeries('NS') as number
    const mateAlignmentStart = decodeDataSeries('NP') as number
    if (mateFlags || mateSequenceId > -1) {
      mateToUse = {
        mateFlags,
        mateSequenceId,
        mateAlignmentStart,
        mateReadName,
      }
    }

    templateSize = decodeDataSeries('TS')

    // set mate unmapped if needed
    if (MateFlagsDecoder.isUnmapped(mateFlags)) {
      flags = BamFlagsDecoder.setMateUnmapped(flags)
    }
    // set mate reversed if needed
    if (MateFlagsDecoder.isOnNegativeStrand(mateFlags)) {
      flags = BamFlagsDecoder.setMateReverseComplemented(flags)
    }

    // detachedCount++
  } else if (CramFlagsDecoder.isWithMateDownstream(cramFlags)) {
    mateRecordNumber = (decodeDataSeries('NF') as number) + recordNumber + 1
  }

  // TODO: the aux tag parsing will have to be refactored if we want to support
  // cram v1
  const TLindex = decodeDataSeries('TL')
  if (TLindex < 0) {
    /* TODO: check nTL: TLindex >= compressionHeader.tagEncoding.size */
    throw new CramMalformedError('invalid TL index')
  }

  const tags: Record<string, any> = {}
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
    tags[tagName] = parseTagData(tagType, tagData)
  }

  let readFeatures
  let lengthOnRef
  let mappingQuality
  let qualityScores: number[] | undefined | null
  let readBases = undefined
  if (!BamFlagsDecoder.isSegmentUnmapped(flags)) {
    // reading read features
    const readFeatureCount = decodeDataSeries('FN') as number
    if (readFeatureCount) {
      readFeatures = decodeReadFeatures(
        alignmentStart,
        readFeatureCount,
        decodeDataSeries,
        compressionScheme,
        majorVersion,
      )
    }

    // compute the read's true span on the reference sequence, and the end coordinate of the alignment on the reference
    lengthOnRef = readLength
    if (readFeatures) {
      for (const { code, data } of readFeatures) {
        if (code === 'D' || code === 'N') {
          lengthOnRef += data
        } else if (code === 'I' || code === 'S') {
          lengthOnRef = subtractInt32(lengthOnRef, data.length)
        } else if (code === 'i') {
          lengthOnRef = subtractInt32(lengthOnRef, assertInt32(1))
        }
      }
    }
    if (Number.isNaN(lengthOnRef)) {
      console.warn(
        `${
          readName || `${sequenceId}:${alignmentStart}`
        } record has invalid read features`,
      )
      lengthOnRef = readLength
    }

    // mapping quality
    mappingQuality = decodeDataSeries('MQ') as number
    if (CramFlagsDecoder.isPreservingQualityScores(cramFlags)) {
      qualityScores = new Array(readLength)
      for (let i = 0; i < qualityScores.length; i++) {
        qualityScores[i] = decodeDataSeries('QS')
      }
    }
  } else if (CramFlagsDecoder.isDecodeSequenceAsStar(cramFlags)) {
    readBases = null
    qualityScores = null
  } else {
    const bases: Int8[] = new Array(readLength)
    for (let i = 0; i < bases.length; i += 1) {
      bases[i] = decodeDataSeries('BA')
    }
    readBases = String.fromCharCode(...bases)

    if (CramFlagsDecoder.isPreservingQualityScores(cramFlags)) {
      qualityScores = new Array(readLength)
      for (let i = 0; i < bases.length; i += 1) {
        qualityScores[i] = decodeDataSeries('QS')
      }
    }
  }

  return {
    readLength,
    sequenceId,
    cramFlags,
    flags,
    alignmentStart,
    readGroupId,
    readName,
    mateToUse,
    templateSize,
    mateRecordNumber,
    readFeatures,
    lengthOnRef,
    mappingQuality,
    qualityScores,
    readBases,
    tags,
  }
}
