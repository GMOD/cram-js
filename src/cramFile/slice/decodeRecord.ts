import { CramMalformedError } from '../../errors.ts'
import { Cursors, DataTypeMapping } from '../codecs/_base.ts'
import { DataSeriesEncodingKey } from '../codecs/dataSeriesTypes.ts'
import CramContainerCompressionScheme, {
  DataSeriesTypes,
} from '../container/compressionScheme.ts'
import {
  BamFlagsDecoder,
  CramFlagsDecoder,
  DecodeOptions,
  MateFlagsDecoder,
  ReadFeature,
} from '../record.ts'
import CramSlice, { SliceHeader } from './index.ts'
import { CramFileBlock } from '../file.ts'
import { isMappedSliceHeader } from '../sectionParsers.ts'

// Reusable TextDecoder instance for string decoding (ASCII/Latin1)
const textDecoder = new TextDecoder('latin1')

/**
 * given a Buffer, read a string up to the first null character
 * @private
 */
function readNullTerminatedString(buffer: Uint8Array) {
  // Find the null terminator
  let end = 0
  while (end < buffer.length && buffer[end] !== 0) {
    end++
  }
  // Decode using TextDecoder (faster than char-by-char concatenation)
  return textDecoder.decode(buffer.subarray(0, end))
}

/**
 * parse a BAM tag's array value from a binary buffer
 * @private
 */
function parseTagValueArray(buffer: Uint8Array) {
  const arrayType = String.fromCharCode(buffer[0]!)

  const dataView = new DataView(buffer.buffer)
  const littleEndian = true
  const length = dataView.getUint32(1, littleEndian)

  const array: number[] = new Array(length)
  buffer = buffer.slice(5)

  if (arrayType === 'c') {
    const arr = new Int8Array(buffer.buffer)
    for (let i = 0; i < length; i++) {
      array[i] = arr[i]!
    }
  } else if (arrayType === 'C') {
    const arr = new Uint8Array(buffer.buffer)
    for (let i = 0; i < length; i++) {
      array[i] = arr[i]!
    }
  } else if (arrayType === 's') {
    const arr = new Int16Array(buffer.buffer)
    for (let i = 0; i < length; i++) {
      array[i] = arr[i]!
    }
  } else if (arrayType === 'S') {
    const arr = new Uint16Array(buffer.buffer)
    for (let i = 0; i < length; i++) {
      array[i] = arr[i]!
    }
  } else if (arrayType === 'i') {
    const arr = new Int32Array(buffer.buffer)
    for (let i = 0; i < length; i++) {
      array[i] = arr[i]!
    }
  } else if (arrayType === 'I') {
    const arr = new Uint32Array(buffer.buffer)
    for (let i = 0; i < length; i++) {
      array[i] = arr[i]!
    }
  } else if (arrayType === 'f') {
    const arr = new Float32Array(buffer.buffer)
    for (let i = 0; i < length; i++) {
      array[i] = arr[i]!
    }
  } else {
    throw new Error(`unknown type: ${arrayType}`)
  }

  return array
}

function parseTagData(tagType: string, buffer: Uint8Array) {
  if (tagType === 'Z') {
    return readNullTerminatedString(buffer)
  }
  if (tagType === 'A') {
    return String.fromCharCode(buffer[0]!)
  }
  if (tagType === 'I') {
    return new Uint32Array(buffer.buffer)[0]
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
    return buffer[0]!
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

// Pre-defined schema lookup tables (version-independent entries)
const data1SchemaBase = {
  B: ['character', 'BA'] as const,
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
} as const

// Version-specific S entry
const data1SchemaV1: Record<string, readonly [string, string]> = {
  ...data1SchemaBase,
  S: ['string', 'IN'] as const,
}
const data1SchemaV2Plus: Record<string, readonly [string, string]> = {
  ...data1SchemaBase,
  S: ['string', 'SC'] as const,
}

// Second data item schema for read features that have two values
const data2Schema: Record<string, readonly [string, string]> = {
  B: ['number', 'QS'] as const,
}

function decodeReadFeatures(
  alignmentStart: number,
  readFeatureCount: number,
  decodeDataSeries: any,
  _compressionScheme: CramContainerCompressionScheme,
  majorVersion: number,
) {
  let currentReadPos = 0
  let currentRefPos = alignmentStart - 1
  const readFeatures: ReadFeature[] = new Array(readFeatureCount)

  // Select the appropriate schema based on version (once per call, not per iteration)
  const data1Schema = majorVersion > 1 ? data1SchemaV2Plus : data1SchemaV1

  function decodeRFData([type, dataSeriesName]: readonly [
    type: string,
    dataSeriesName: string,
  ]) {
    const data = decodeDataSeries(dataSeriesName)
    if (type === 'character') {
      return String.fromCharCode(data)
    } else if (type === 'string') {
      return textDecoder.decode(data)
    } else if (type === 'numArray') {
      return Array.from(data)
    }
    return data
  }

  for (let i = 0; i < readFeatureCount; i++) {
    const code = String.fromCharCode(decodeDataSeries('FC'))

    const readPosDelta = decodeDataSeries('FP')

    const schema = data1Schema[code]

    if (!schema) {
      throw new CramMalformedError(`invalid read feature code "${code}"`)
    }

    let data: any = decodeRFData(schema)

    // if this is a read feature with two data items, make the data an array
    const schema2 = data2Schema[code]
    if (schema2) {
      data = [data, decodeRFData(schema2)]
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
) => DataTypeMapping[DataSeriesTypes[T]] | undefined

export type BulkByteDecoder = (
  dataSeriesName: 'QS' | 'BA',
  length: number,
) => number[] | undefined

export type BulkByteRawDecoder = (
  dataSeriesName: 'QS' | 'BA',
  length: number,
) => Uint8Array | undefined

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
  decodeBulkBytes?: BulkByteDecoder,
  decodeOptions?: Required<DecodeOptions>,
  decodeBulkBytesRaw?: BulkByteRawDecoder,
) {
  let flags = decodeDataSeries('BF')!

  // note: the C data type of compressionFlags is byte in cram v1 and int32 in
  // cram v2+, but that does not matter for us here in javascript land.
  const cramFlags = decodeDataSeries('CF')!

  if (!isMappedSliceHeader(sliceHeader.parsedContent)) {
    throw new Error('slice header not mapped')
  }

  const sequenceId =
    majorVersion > 1 && sliceHeader.parsedContent.refSeqId === -2
      ? decodeDataSeries('RI')
      : sliceHeader.parsedContent.refSeqId

  const readLength = decodeDataSeries('RL')!
  // if APDelta, will calculate the true start in a second pass
  let alignmentStart = decodeDataSeries('AP')!
  if (compressionScheme.APdelta) {
    alignmentStart = alignmentStart + cursors.lastAlignmentStart
  }
  cursors.lastAlignmentStart = alignmentStart
  const readGroupId = decodeDataSeries('RG')!

  let readName: string | undefined
  if (compressionScheme.readNamesIncluded) {
    readName = readNullTerminatedString(decodeDataSeries('RN')!)
  }

  let mateToUse:
    | {
        mateFlags: number
        mateSequenceId: number
        mateAlignmentStart: number
        mateReadName: string | undefined
      }
    | undefined
  let templateSize: number | undefined
  let mateRecordNumber: number | undefined
  // mate record
  if (CramFlagsDecoder.isDetached(cramFlags)) {
    // note: the MF is a byte in 1.0, int32 in 2+, but once again this doesn't
    // matter for javascript
    const mateFlags = decodeDataSeries('MF')!
    let mateReadName: string | undefined
    if (!compressionScheme.readNamesIncluded) {
      mateReadName = readNullTerminatedString(decodeDataSeries('RN')!)
      readName = mateReadName
    }
    const mateSequenceId = decodeDataSeries('NS')!
    const mateAlignmentStart = decodeDataSeries('NP')!
    if (mateFlags || mateSequenceId > -1) {
      mateToUse = {
        mateFlags,
        mateSequenceId,
        mateAlignmentStart,
        mateReadName,
      }
    }

    templateSize = decodeDataSeries('TS')!

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
    mateRecordNumber = decodeDataSeries('NF')! + recordNumber + 1
  }

  // TODO: the aux tag parsing will have to be refactored if we want to support
  // cram v1
  const TLindex = decodeDataSeries('TL')!
  if (TLindex < 0) {
    /* TODO: check nTL: TLindex >= compressionHeader.tagEncoding.size */
    throw new CramMalformedError('invalid TL index')
  }

  const tags: Record<string, any> = {}
  // TN = tag names
  const TN = compressionScheme.getTagNames(TLindex)!
  const ntags = TN.length
  for (let i = 0; i < ntags; i++) {
    const tagId = TN[i]!
    // Use direct character access instead of slice() to avoid string allocation
    const tagName = tagId[0]! + tagId[1]!
    const tagType = tagId[2]!

    const tagData = compressionScheme
      .getCodecForTag(tagId)
      .decode(slice, coreDataBlock, blocksByContentId, cursors)
    tags[tagName] =
      tagData === undefined
        ? undefined
        : typeof tagData === 'number'
          ? tagData
          : parseTagData(tagType, tagData)
  }

  let readFeatures: ReadFeature[] | undefined
  let lengthOnRef: number | undefined
  let mappingQuality: number | undefined
  let qualityScores: number[] | undefined | null
  let qualityScoresRaw: Uint8Array | undefined
  let readBases = undefined
  if (!BamFlagsDecoder.isSegmentUnmapped(flags)) {
    // reading read features
    const readFeatureCount = decodeDataSeries('FN')!
    if (readFeatureCount) {
      readFeatures = decodeReadFeatures(
        alignmentStart,
        readFeatureCount,
        decodeDataSeries,
        compressionScheme,
        majorVersion,
      )
    }

    // compute the read's true span on the reference sequence, and the end
    // coordinate of the alignment on the reference
    lengthOnRef = readLength
    if (readFeatures) {
      for (const { code, data } of readFeatures) {
        if (code === 'D' || code === 'N') {
          lengthOnRef += data
        } else if (code === 'I' || code === 'S') {
          lengthOnRef = lengthOnRef - data.length
        } else if (code === 'i') {
          lengthOnRef = lengthOnRef - 1
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
    mappingQuality = decodeDataSeries('MQ')!

    if (CramFlagsDecoder.isPreservingQualityScores(cramFlags)) {
      // Try to store raw bytes for lazy decoding (most efficient)
      const rawQS = decodeBulkBytesRaw?.('QS', readLength)
      if (rawQS) {
        qualityScoresRaw = rawQS
      } else {
        // Fallback to immediate decoding for non-external codecs
        const bulkQS = decodeBulkBytes?.('QS', readLength)
        if (bulkQS) {
          qualityScores = bulkQS
        } else {
          qualityScores = new Array(readLength)
          for (let i = 0; i < qualityScores.length; i++) {
            qualityScores[i] = decodeDataSeries('QS')!
          }
        }
      }
    }
  } else if (CramFlagsDecoder.isDecodeSequenceAsStar(cramFlags)) {
    readBases = null
    qualityScores = null
  } else {
    // Try raw bytes first for TextDecoder (most efficient)
    const rawBA = decodeBulkBytesRaw?.('BA', readLength)
    if (rawBA) {
      readBases = textDecoder.decode(rawBA)
    } else {
      // Fallback to single-byte decoding
      let s = ''
      for (let i = 0; i < readLength; i++) {
        s += String.fromCharCode(decodeDataSeries('BA')!)
      }
      readBases = s
    }

    if (CramFlagsDecoder.isPreservingQualityScores(cramFlags)) {
      // Try to store raw bytes for lazy decoding (most efficient)
      const rawQS = decodeBulkBytesRaw?.('QS', readLength)
      if (rawQS) {
        qualityScoresRaw = rawQS
      } else {
        // Fallback to immediate decoding for non-external codecs
        const bulkQS = decodeBulkBytes?.('QS', readLength)
        if (bulkQS) {
          qualityScores = bulkQS
        } else {
          qualityScores = new Array(readLength)
          for (let i = 0; i < readLength; i++) {
            qualityScores[i] = decodeDataSeries('QS')!
          }
        }
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
    qualityScoresRaw,
    readBases,
    tags,
  }
}
