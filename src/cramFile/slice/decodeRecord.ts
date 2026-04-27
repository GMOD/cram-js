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

// Read-feature schema: a charCode-indexed array of [letter, fn] tuples where
// fn() decodes the feature's data, fully transformed
// (character → fromCharCode, string → decodeLatin1, numArray → Array.from,
// number → identity, B → [base, qualityScore]). Built once per slice; the
// inner loop becomes a charCode lookup + monomorphic call.
type RFData = string | number | number[] | [string, number]
type RFFn = () => RFData
export type RFEntry = readonly [code: string, fn: RFFn]

export function buildRFSchema(
  bd: BoundDecoders,
  majorVersion: number,
): (RFEntry | undefined)[] {
  const SC = majorVersion > 1 ? bd.SC : bd.IN
  const arr: (RFEntry | undefined)[] = new Array(128)
  arr['B'.charCodeAt(0)] = [
    'B',
    () => [String.fromCharCode(bd.BA()!), bd.QS()!],
  ]
  arr['X'.charCodeAt(0)] = ['X', () => bd.BS()!]
  arr['D'.charCodeAt(0)] = ['D', () => bd.DL()!]
  arr['I'.charCodeAt(0)] = ['I', () => decodeLatin1(bd.IN()!)]
  arr['i'.charCodeAt(0)] = ['i', () => String.fromCharCode(bd.BA()!)]
  arr['b'.charCodeAt(0)] = ['b', () => decodeLatin1(bd.BB()!)]
  arr['q'.charCodeAt(0)] = ['q', () => Array.from(bd.QQ()!)]
  arr['Q'.charCodeAt(0)] = ['Q', () => bd.QS()!]
  arr['H'.charCodeAt(0)] = ['H', () => bd.HC()!]
  arr['P'.charCodeAt(0)] = ['P', () => bd.PD()!]
  arr['N'.charCodeAt(0)] = ['N', () => bd.RS()!]
  arr['S'.charCodeAt(0)] = ['S', () => decodeLatin1(SC()!)]
  return arr
}

function decodeReadFeatures(
  alignmentStart: number,
  readFeatureCount: number,
  bd: BoundDecoders,
  schema: (RFEntry | undefined)[],
) {
  // Track the running offset between ref and read coordinates so that
  // refPos = readPos + refOffset. Deletions advance ref past consumed
  // ref bases (offset goes up); insertions advance read past consumed
  // read bases (offset goes down). This mirrors CIGAR consume-ref vs
  // consume-read semantics.
  let readPos = 0
  let refOffset = alignmentStart - 1
  const readFeatures: ReadFeature[] = new Array(readFeatureCount)
  const decodeFC = bd.FC
  const decodeFP = bd.FP

  for (let i = 0; i < readFeatureCount; i++) {
    const codeNum = decodeFC()!
    readPos += decodeFP()!
    const entry = schema[codeNum]

    if (!entry) {
      throw new CramMalformedError(
        `invalid read feature code "${String.fromCharCode(codeNum)}"`,
      )
    }

    const code = entry[0]
    const data = entry[1]()

    readFeatures[i] = {
      code,
      pos: readPos,
      refPos: readPos + refOffset,
      data,
    } as ReadFeature

    if (code === 'D' || code === 'N') {
      refOffset += data as number
    } else if (code === 'I' || code === 'S') {
      refOffset -= (data as string).length
    } else if (code === 'i') {
      refOffset -= 1
    }
  }
  return readFeatures
}

export type BulkByteRawDecoder = (
  dataSeriesName: 'QS' | 'BA',
  length: number,
) => Uint8Array | undefined

function decodeQualityScores(
  readLength: number,
  decodeBulkBytesRaw: BulkByteRawDecoder | undefined,
  decodeQS: () => number | undefined,
) {
  const raw = decodeBulkBytesRaw?.('QS', readLength)
  if (raw) {
    return raw
  }
  const out = new Uint8Array(readLength)
  for (let i = 0; i < readLength; i++) {
    out[i] = decodeQS()!
  }
  return out
}

function decodeReadBases(
  readLength: number,
  decodeBulkBytesRaw: BulkByteRawDecoder | undefined,
  decodeBA: () => number | undefined,
) {
  const raw = decodeBulkBytesRaw?.('BA', readLength)
  if (raw) {
    return decodeLatin1(raw)
  }
  let s = ''
  for (let i = 0; i < readLength; i++) {
    s += String.fromCharCode(decodeBA()!)
  }
  return s
}

export type BoundTagDecoders = Record<
  string,
  () => Uint8Array | number | undefined
>

export default function decodeRecord(
  slice: CramSlice,
  bd: BoundDecoders,
  rfSchema: (RFEntry | undefined)[],
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
        rfSchema,
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
      qualityScores = decodeQualityScores(readLength, decodeBulkBytesRaw, bd.QS)
    }
  } else if (CramFlagsDecoder.isDecodeSequenceAsStar(cramFlags)) {
    readBases = null
    qualityScores = null
  } else {
    readBases = decodeReadBases(readLength, decodeBulkBytesRaw, bd.BA)
    if (CramFlagsDecoder.isPreservingQualityScores(cramFlags)) {
      qualityScores = decodeQualityScores(readLength, decodeBulkBytesRaw, bd.QS)
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
