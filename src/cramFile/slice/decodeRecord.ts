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
import { decodeLatin1, readNullTerminatedStringFromBuffer } from '../util.ts'

/**
 * parse a BAM tag's array value from a binary buffer
 * @private
 */
// Uses DataView instead of typed arrays (e.g. new Int32Array(buffer.buffer))
// because the buffer may be a subarray of a larger ArrayBuffer. Typed array
// constructors like Int32Array interpret .buffer as the entire underlying
// ArrayBuffer starting at byte 0, ignoring the subarray's byteOffset. This
// caused silent data corruption when reading tag values. DataView with explicit
// byteOffset reads from the correct position within the parent buffer.
function parseTagValueArray(buffer: Uint8Array) {
  const arrayType = String.fromCharCode(buffer[0]!)

  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const length = dv.getUint32(1, true)

  const array: number[] = new Array(length)
  const dataOffset = 5

  if (arrayType === 'c') {
    for (let i = 0; i < length; i++) {
      array[i] = dv.getInt8(dataOffset + i)
    }
  } else if (arrayType === 'C') {
    for (let i = 0; i < length; i++) {
      array[i] = dv.getUint8(dataOffset + i)
    }
  } else if (arrayType === 's') {
    for (let i = 0; i < length; i++) {
      array[i] = dv.getInt16(dataOffset + i * 2, true)
    }
  } else if (arrayType === 'S') {
    for (let i = 0; i < length; i++) {
      array[i] = dv.getUint16(dataOffset + i * 2, true)
    }
  } else if (arrayType === 'i') {
    for (let i = 0; i < length; i++) {
      array[i] = dv.getInt32(dataOffset + i * 4, true)
    }
  } else if (arrayType === 'I') {
    for (let i = 0; i < length; i++) {
      array[i] = dv.getUint32(dataOffset + i * 4, true)
    }
  } else if (arrayType === 'f') {
    for (let i = 0; i < length; i++) {
      array[i] = dv.getFloat32(dataOffset + i * 4, true)
    }
  } else {
    throw new Error(`unknown type: ${arrayType}`)
  }

  return array
}

function parseTagData(tagType: string, buffer: Uint8Array) {
  if (tagType === 'Z') {
    return readNullTerminatedStringFromBuffer(buffer)
  }
  if (tagType === 'A') {
    return String.fromCharCode(buffer[0]!)
  }
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  if (tagType === 'I') {
    return dv.getUint32(0, true)
  }
  if (tagType === 'i') {
    return dv.getInt32(0, true)
  }
  if (tagType === 's') {
    return dv.getInt16(0, true)
  }
  if (tagType === 'S') {
    return dv.getUint16(0, true)
  }
  if (tagType === 'c') {
    return dv.getInt8(0)
  }
  if (tagType === 'C') {
    return buffer[0]!
  }
  if (tagType === 'f') {
    return dv.getFloat32(0, true)
  }
  if (tagType === 'H') {
    return Number.parseInt(
      readNullTerminatedStringFromBuffer(buffer).replace(/^0x/, ''),
      16,
    )
  }
  if (tagType === 'B') {
    return parseTagValueArray(buffer)
  }

  throw new CramMalformedError(`Unrecognized tag type ${tagType}`)
}

// Read feature schema lookup tables. Each entry maps a feature code to
// [dataType, dataSeriesName] where dataType controls how the raw codec
// output is converted (character→fromCharCode, string→TextDecoder,
// numArray→Array.from, number→as-is).
const data1SchemaBase = {
  B: ['character', 'BA'] as const, // base substitution (base component)
  X: ['number', 'BS'] as const, // base substitution matrix index
  D: ['number', 'DL'] as const, // deletion length
  I: ['string', 'IN'] as const, // insertion bases
  i: ['character', 'BA'] as const, // single-base insertion
  b: ['string', 'BB'] as const, // stretch of bases
  q: ['numArray', 'QQ'] as const, // stretch of quality scores
  Q: ['number', 'QS'] as const, // single quality score
  H: ['number', 'HC'] as const, // hard clip length
  P: ['number', 'PD'] as const, // padding length
  N: ['number', 'RS'] as const, // reference skip length
} as const

// Soft clip data series changed between CRAM v1 (IN) and v2+ (SC)
const data1SchemaV1: Record<string, readonly [string, string]> = {
  ...data1SchemaBase,
  S: ['string', 'IN'] as const,
}
const data1SchemaV2Plus: Record<string, readonly [string, string]> = {
  ...data1SchemaBase,
  S: ['string', 'SC'] as const,
}

// Features with a second data item (B has both a base and a quality score)
const data2Schema: Record<string, readonly [string, string]> = {
  B: ['number', 'QS'] as const,
}

function decodeReadFeatures(
  alignmentStart: number,
  readFeatureCount: number,
  decodeDataSeries: DataSeriesDecoder,
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
  ]): string | number | number[] {
    const data = decodeDataSeries(dataSeriesName as DataSeriesEncodingKey)
    if (type === 'character') {
      return String.fromCharCode(data as number)
    } else if (type === 'string') {
      return decodeLatin1(data as Uint8Array)
    } else if (type === 'numArray') {
      return Array.from(data as Uint8Array)
    }
    return data as number
  }

  for (let i = 0; i < readFeatureCount; i++) {
    const code = String.fromCharCode(decodeDataSeries('FC')!)

    const readPosDelta = decodeDataSeries('FP')!

    const schema = data1Schema[code]

    if (!schema) {
      throw new CramMalformedError(`invalid read feature code "${code}"`)
    }

    let data: string | number | number[] | [string, number] =
      decodeRFData(schema)

    // if this is a read feature with two data items, make the data a tuple
    const schema2 = data2Schema[code]
    if (schema2) {
      data = [data as string, decodeRFData(schema2) as number]
    }

    currentReadPos += readPosDelta
    const pos = currentReadPos

    currentRefPos += readPosDelta
    const refPos = currentRefPos

    // for gapping features, adjust the reference position for read features that follow
    if (code === 'D' || code === 'N') {
      currentRefPos += data as number
    } else if (code === 'I' || code === 'S') {
      currentRefPos -= (data as string).length
    } else if (code === 'i') {
      currentRefPos -= 1
    }

    readFeatures[i] = { code, pos, refPos, data } as ReadFeature
  }
  return readFeatures
}

export type DataSeriesDecoder = <T extends DataSeriesEncodingKey>(
  dataSeriesName: T,
) => DataTypeMapping[DataSeriesTypes[T]] | undefined

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
  uniqueId: number,
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

  let readNameRaw: Uint8Array | undefined
  if (compressionScheme.readNamesIncluded) {
    readNameRaw = decodeDataSeries('RN')!
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
      readNameRaw = decodeDataSeries('RN')!
      mateReadName = readNullTerminatedStringFromBuffer(readNameRaw)
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

  type TagValue = string | number | number[] | undefined
  const tags: Record<string, TagValue> = {}
  // TN = tag names
  const TN = compressionScheme.getTagNames(TLindex)!
  const ntags = TN.length
  const shouldDecodeTags = decodeOptions?.decodeTags !== false
  if (shouldDecodeTags) {
    for (let i = 0; i < ntags; i++) {
      const tagId = TN[i]!
      const tagData = compressionScheme
        .getCodecForTag(tagId)
        .decode(slice, coreDataBlock, blocksByContentId, cursors)

      const tagName = tagId[0]! + tagId[1]!
      const tagType = tagId[2]!
      tags[tagName] =
        tagData === undefined
          ? undefined
          : typeof tagData === 'number'
            ? tagData
            : parseTagData(tagType, tagData)
    }
  }

  let readFeatures: ReadFeature[] | undefined
  let lengthOnRef: number | undefined
  let mappingQuality: number | undefined
  let qualityScores: Uint8Array | undefined | null
  let readBases = undefined
  if (!BamFlagsDecoder.isSegmentUnmapped(flags)) {
    // reading read features
    const readFeatureCount = decodeDataSeries('FN')!
    if (readFeatureCount) {
      readFeatures = decodeReadFeatures(
        alignmentStart,
        readFeatureCount,
        decodeDataSeries,
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
        `${sequenceId}:${alignmentStart} record has invalid read features`,
      )
      lengthOnRef = readLength
    }

    // mapping quality
    mappingQuality = decodeDataSeries('MQ')!

    if (CramFlagsDecoder.isPreservingQualityScores(cramFlags)) {
      // Try raw bytes first (most efficient - just a subarray view)
      const rawQS = decodeBulkBytesRaw?.('QS', readLength)
      if (rawQS) {
        qualityScores = rawQS
      } else {
        // Fallback to single-byte decoding into new Uint8Array
        qualityScores = new Uint8Array(readLength)
        for (let i = 0; i < readLength; i++) {
          qualityScores[i] = decodeDataSeries('QS')!
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
      readBases = decodeLatin1(rawBA)
    } else {
      // Fallback to single-byte decoding
      let s = ''
      for (let i = 0; i < readLength; i++) {
        s += String.fromCharCode(decodeDataSeries('BA')!)
      }
      readBases = s
    }

    if (CramFlagsDecoder.isPreservingQualityScores(cramFlags)) {
      // Try raw bytes first (most efficient - just a subarray view)
      const rawQS = decodeBulkBytesRaw?.('QS', readLength)
      if (rawQS) {
        qualityScores = rawQS
      } else {
        // Fallback to single-byte decoding into new Uint8Array
        qualityScores = new Uint8Array(readLength)
        for (let i = 0; i < readLength; i++) {
          qualityScores[i] = decodeDataSeries('QS')!
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
    readNameRaw,
    mateToUse,
    templateSize,
    mateRecordNumber,
    readFeatures,
    lengthOnRef,
    mappingQuality,
    qualityScores,
    readBases,
    tags,
    uniqueId,
  }
}
