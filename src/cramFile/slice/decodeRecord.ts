import { CramMalformedError } from '../../errors.ts'
import {
  BamFlagsDecoder,
  CramFlagsDecoder,
  type DecodeOptions,
  MateFlagsDecoder,
  type MateRecord,
  type ReadFeature,
} from '../record.ts'
import { type SliceHeader } from './index.ts'
import { isMappedSliceHeader } from '../sectionParsers.ts'
import { decodeLatin1, readNullTerminatedStringFromBuffer } from '../util.ts'

import type { CramFileBlock } from '../file.ts'
import type CramSlice from './index.ts'
import type { Cursors } from '../codecs/_base.ts'
import type CramContainerCompressionScheme from '../container/compressionScheme.ts'

// Each method returns the next decoded value for that data series, advancing
// the underlying cursor. Built once per slice in slice/index.ts as a fixed-
// shape object literal so call sites get monomorphic property access.
export interface BoundDecoders {
  BF(): number | undefined
  CF(): number | undefined
  RI(): number | undefined
  RL(): number | undefined
  AP(): number | undefined
  RG(): number | undefined
  RN(): Uint8Array | undefined
  MF(): number | undefined
  NS(): number | undefined
  NP(): number | undefined
  TS(): number | undefined
  NF(): number | undefined
  TL(): number | undefined
  FN(): number | undefined
  FC(): number | undefined
  FP(): number | undefined
  DL(): number | undefined
  BB(): Uint8Array | undefined
  QQ(): Uint8Array | undefined
  BS(): number | undefined
  IN(): Uint8Array | undefined
  RS(): number | undefined
  PD(): number | undefined
  HC(): number | undefined
  SC(): Uint8Array | undefined
  MQ(): number | undefined
  BA(): number | undefined
  QS(): number | undefined
  TC(): number | undefined
  TN(): number | undefined
}

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
  if (tagType === 'C') {
    return buffer[0]!
  }
  if (tagType === 'c') {
    return buffer[0]! > 127 ? buffer[0]! - 256 : buffer[0]!
  }
  if (tagType === 'B') {
    return parseTagValueArray(buffer)
  }
  if (tagType === 'H') {
    return Number.parseInt(
      readNullTerminatedStringFromBuffer(buffer).replace(/^0x/, ''),
      16,
    )
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
  if (tagType === 'f') {
    return dv.getFloat32(0, true)
  }

  throw new CramMalformedError(`Unrecognized tag type ${tagType}`)
}

// Read feature schema: maps a feature code to [transformKind, decoder] where
// transformKind controls how the raw codec output is converted
// (character→fromCharCode, string→TextDecoder, numArray→Array.from,
// number→as-is). Built once per slice from the BoundDecoders, so the inner
// loop is just a direct decoder call + transform.
type RFTransform = 'character' | 'string' | 'numArray' | 'number'
type RFDecoder = () => number | Uint8Array | undefined
type RFEntry = readonly [RFTransform, RFDecoder]

export interface RFSchemas {
  data1: Record<string, RFEntry | undefined>
  data2: Record<string, RFEntry | undefined>
}

export function buildRFSchemas(
  bd: BoundDecoders,
  majorVersion: number,
): RFSchemas {
  const SC = majorVersion > 1 ? bd.SC : bd.IN
  return {
    data1: {
      B: ['character', bd.BA], // base substitution (base component)
      X: ['number', bd.BS], // base substitution matrix index
      D: ['number', bd.DL], // deletion length
      I: ['string', bd.IN], // insertion bases
      i: ['character', bd.BA], // single-base insertion
      b: ['string', bd.BB], // stretch of bases
      q: ['numArray', bd.QQ], // stretch of quality scores
      Q: ['number', bd.QS], // single quality score
      H: ['number', bd.HC], // hard clip length
      P: ['number', bd.PD], // padding length
      N: ['number', bd.RS], // reference skip length
      S: ['string', SC],
    },
    // features with a second data item (B has both base and quality score)
    data2: {
      B: ['number', bd.QS],
    },
  }
}

// Pre-computed lookup: charCode -> feature code string
const featureCodeFromCharCode: string[] = new Array(128)
for (const c of 'BXDIibqQHPNS') {
  featureCodeFromCharCode[c.charCodeAt(0)] = c
}

function decodeRFData(entry: RFEntry): string | number | number[] {
  const data = entry[1]()
  const type = entry[0]
  if (type === 'character') {
    return String.fromCharCode(data as number)
  } else if (type === 'string') {
    return decodeLatin1(data as Uint8Array)
  } else if (type === 'numArray') {
    return Array.from(data as Uint8Array)
  }
  return data as number
}

function decodeReadFeatures(
  alignmentStart: number,
  readFeatureCount: number,
  bd: BoundDecoders,
  schemas: RFSchemas,
) {
  let currentReadPos = 0
  let currentRefPos = alignmentStart - 1
  const readFeatures: ReadFeature[] = new Array(readFeatureCount)
  const decodeFC = bd.FC
  const decodeFP = bd.FP
  const { data1, data2 } = schemas

  for (let i = 0; i < readFeatureCount; i++) {
    const codeNum = decodeFC()!
    const code = featureCodeFromCharCode[codeNum]

    const readPosDelta = decodeFP()!

    const schema = data1[code!]

    if (!schema) {
      throw new CramMalformedError(
        `invalid read feature code "${String.fromCharCode(codeNum)}"`,
      )
    }

    let data: string | number | number[] | [string, number] =
      decodeRFData(schema)

    const schema2 = data2[code!]
    if (schema2) {
      data = [data as string, decodeRFData(schema2) as number]
    }

    currentReadPos += readPosDelta
    const pos = currentReadPos

    currentRefPos += readPosDelta
    const refPos = currentRefPos

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

export type BulkByteRawDecoder = (
  dataSeriesName: 'QS' | 'BA',
  length: number,
) => Uint8Array | undefined

export type BoundTagDecoders = Record<
  string,
  () => Uint8Array | number | undefined
>

export default function decodeRecord(
  slice: CramSlice,
  bd: BoundDecoders,
  rfSchemas: RFSchemas,
  boundTagDecoders: BoundTagDecoders,
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
  let flags = bd.BF()!

  // note: the C data type of compressionFlags is byte in cram v1 and int32 in
  // cram v2+, but that does not matter for us here in javascript land.
  const cramFlags = bd.CF()!

  if (!isMappedSliceHeader(sliceHeader.parsedContent)) {
    throw new Error('slice header not mapped')
  }

  const sequenceId =
    majorVersion > 1 && sliceHeader.parsedContent.refSeqId === -2
      ? bd.RI()
      : sliceHeader.parsedContent.refSeqId

  const readLength = bd.RL()!
  // if APDelta, will calculate the true start in a second pass
  let alignmentStart = bd.AP()!
  if (compressionScheme.APdelta) {
    alignmentStart = alignmentStart + cursors.lastAlignmentStart
  }
  cursors.lastAlignmentStart = alignmentStart
  const readGroupId = bd.RG()!

  let readNameRaw: Uint8Array | undefined
  if (compressionScheme.readNamesIncluded) {
    readNameRaw = bd.RN()!
  }

  let mate: MateRecord | undefined
  let templateSize: number | undefined
  let mateRecordNumber: number | undefined
  // mate record
  if (CramFlagsDecoder.isDetached(cramFlags)) {
    // note: the MF is a byte in 1.0, int32 in 2+, but once again this doesn't
    // matter for javascript
    const mateFlags = bd.MF()!
    let mateReadName: string | undefined
    if (!compressionScheme.readNamesIncluded) {
      readNameRaw = bd.RN()!
      mateReadName = readNullTerminatedStringFromBuffer(readNameRaw)
    }
    const mateSequenceId = bd.NS()!
    const mateAlignmentStart = bd.NP()!
    if (mateFlags || mateSequenceId > -1) {
      mate = {
        flags: mateFlags,
        sequenceId: mateSequenceId,
        alignmentStart: mateAlignmentStart,
        readName: mateReadName,
      }
    }

    templateSize = bd.TS()!

    // set mate unmapped if needed
    if (MateFlagsDecoder.isUnmapped(mateFlags)) {
      flags = BamFlagsDecoder.setMateUnmapped(flags)
    }
    // set mate reversed if needed
    if (MateFlagsDecoder.isOnNegativeStrand(mateFlags)) {
      flags = BamFlagsDecoder.setMateReverseComplemented(flags)
    }
  } else if (CramFlagsDecoder.isWithMateDownstream(cramFlags)) {
    mateRecordNumber = bd.NF()! + recordNumber + 1
  }

  // TODO: the aux tag parsing will have to be refactored if we want to support
  // cram v1
  const TLindex = bd.TL()!
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
      const tagData = boundTagDecoders[tagId]!()

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
    const readFeatureCount = bd.FN()!
    if (readFeatureCount) {
      readFeatures = decodeReadFeatures(
        alignmentStart,
        readFeatureCount,
        bd,
        rfSchemas,
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
    mappingQuality = bd.MQ()!

    if (CramFlagsDecoder.isPreservingQualityScores(cramFlags)) {
      // Try raw bytes first (most efficient - just a subarray view)
      const rawQS = decodeBulkBytesRaw?.('QS', readLength)
      if (rawQS) {
        qualityScores = rawQS
      } else {
        // Fallback to single-byte decoding into new Uint8Array
        qualityScores = new Uint8Array(readLength)
        const decodeQS = bd.QS
        for (let i = 0; i < readLength; i++) {
          qualityScores[i] = decodeQS()!
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
      const decodeBA = bd.BA
      for (let i = 0; i < readLength; i++) {
        s += String.fromCharCode(decodeBA()!)
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
        const decodeQS = bd.QS
        for (let i = 0; i < readLength; i++) {
          qualityScores[i] = decodeQS()!
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
    mate,
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
