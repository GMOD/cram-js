import { CramMalformedError } from '../../errors.ts'
import {
  BamFlagsDecoder,
  CramFlagsDecoder,
  MateFlagsDecoder,
  type MateRecord,
  type ReadFeature,
} from '../record.ts'
import { decodeUtf8, readNullTerminatedStringFromBuffer } from '../util.ts'

import type { Cursors } from '../codecs/_base.ts'
import type { DataSeriesEncodingKey } from '../codecs/dataSeriesTypes.ts'
import type { DataSeriesTypes } from '../container/compressionScheme.ts'

/** Data series whose codecs yield a Uint8Array rather than a number. */
export type ByteArraySeries = {
  [K in DataSeriesEncodingKey]: DataSeriesTypes[K] extends 'byteArray'
    ? K
    : never
}[DataSeriesEncodingKey]

export type NumericSeries = Exclude<DataSeriesEncodingKey, ByteArraySeries>

// Each method returns the next decoded value for that data series, advancing
// the underlying cursor. Built once per slice in slice/index.ts as a fixed-
// shape object literal so call sites get monomorphic property access. Derived
// from dataSeriesTypes so the two cannot drift apart.
export type BoundDecoders = {
  [K in DataSeriesEncodingKey]: () => K extends ByteArraySeries
    ? Uint8Array
    : number
}

// Tag buffers are subarrays of a larger block, so a typed-array view over
// buffer.buffer would ignore byteOffset and read the wrong bytes. The obvious
// alternative — a DataView per value — allocates on every tag of every record
// and measured ~60x slower than the explicit little-endian byte math below.
// CramFile refuses to run on big-endian machines, so LE is safe to assume.
function readInt32LE(b: Uint8Array, o: number) {
  return b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)
}
function readUint32LE(b: Uint8Array, o: number) {
  return readInt32LE(b, o) >>> 0
}
function readInt16LE(b: Uint8Array, o: number) {
  return (((b[o]! | (b[o + 1]! << 8)) << 16) >> 16) | 0
}
function readUint16LE(b: Uint8Array, o: number) {
  return b[o]! | (b[o + 1]! << 8)
}
// float32 has no integer-arithmetic equivalent, so reuse one scratch pair
// rather than allocating a view per value
const floatScratchBytes = new Uint8Array(4)
const floatScratch = new Float32Array(floatScratchBytes.buffer)
function readFloat32LE(b: Uint8Array, o: number) {
  floatScratchBytes[0] = b[o]!
  floatScratchBytes[1] = b[o + 1]!
  floatScratchBytes[2] = b[o + 2]!
  floatScratchBytes[3] = b[o + 3]!
  return floatScratch[0]!
}

function parseTagValueArray(buffer: Uint8Array) {
  const arrayType = String.fromCharCode(buffer[0]!)
  const length = readUint32LE(buffer, 1)

  const array: number[] = new Array(length)
  const dataOffset = 5

  if (arrayType === 'c') {
    for (let i = 0; i < length; i++) {
      array[i] = ((buffer[dataOffset + i]! << 24) >> 24) | 0
    }
  } else if (arrayType === 'C') {
    for (let i = 0; i < length; i++) {
      array[i] = buffer[dataOffset + i]!
    }
  } else if (arrayType === 's') {
    for (let i = 0; i < length; i++) {
      array[i] = readInt16LE(buffer, dataOffset + i * 2)
    }
  } else if (arrayType === 'S') {
    for (let i = 0; i < length; i++) {
      array[i] = readUint16LE(buffer, dataOffset + i * 2)
    }
  } else if (arrayType === 'i') {
    for (let i = 0; i < length; i++) {
      array[i] = readInt32LE(buffer, dataOffset + i * 4)
    }
  } else if (arrayType === 'I') {
    for (let i = 0; i < length; i++) {
      array[i] = readUint32LE(buffer, dataOffset + i * 4)
    }
  } else if (arrayType === 'f') {
    for (let i = 0; i < length; i++) {
      array[i] = readFloat32LE(buffer, dataOffset + i * 4)
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
  if (tagType === 'I') {
    return readUint32LE(buffer, 0)
  }
  if (tagType === 'i') {
    return readInt32LE(buffer, 0)
  }
  if (tagType === 's') {
    return readInt16LE(buffer, 0)
  }
  if (tagType === 'S') {
    return readUint16LE(buffer, 0)
  }
  if (tagType === 'f') {
    return readFloat32LE(buffer, 0)
  }

  throw new CramMalformedError(`Unrecognized tag type ${tagType}`)
}

// Read-feature schema: a charCode-indexed array of entries whose decode()
// reads and transforms the feature's data (character → fromCharCode,
// string → decodeUtf8, numArray → Array.from, number → identity,
// B → [base, qualityScore]). Built once per slice, so the inner loop becomes
// a charCode lookup plus a monomorphic call.
type RFData = string | number | number[] | [string, number]

/**
 * How a feature advances the reference position relative to the read, folded
 * into the schema so the decode loop can branch on a small integer instead of
 * comparing the feature code against five strings per feature.
 */
const DELTA_NONE = 0
const DELTA_ADD_DATA = 1 // D, N: data is the number of reference bases skipped
const DELTA_SUB_DATA_LENGTH = 2 // I, S: data is inserted/clipped read sequence
const DELTA_SUB_ONE = 3 // i: single inserted base

export interface RFEntry {
  code: ReadFeature['code']
  decode: () => RFData
  deltaKind:
    | typeof DELTA_NONE
    | typeof DELTA_ADD_DATA
    | typeof DELTA_SUB_DATA_LENGTH
    | typeof DELTA_SUB_ONE
}

export function buildRFSchema(
  bd: BoundDecoders,
  majorVersion: number,
): (RFEntry | undefined)[] {
  const SC = majorVersion > 1 ? bd.SC : bd.IN
  // filled rather than left sparse: a holey array degrades every lookup in the
  // decode loop below
  const arr: (RFEntry | undefined)[] = new Array(128).fill(undefined)
  const set = (
    code: ReadFeature['code'],
    deltaKind: RFEntry['deltaKind'],
    decode: () => RFData,
  ) => {
    arr[code.charCodeAt(0)] = { code, decode, deltaKind }
  }
  set('B', DELTA_NONE, () => [String.fromCharCode(bd.BA()), bd.QS()])
  set('X', DELTA_NONE, () => bd.BS())
  set('D', DELTA_ADD_DATA, () => bd.DL())
  set('I', DELTA_SUB_DATA_LENGTH, () => decodeUtf8(bd.IN()))
  set('i', DELTA_SUB_ONE, () => String.fromCharCode(bd.BA()))
  set('b', DELTA_NONE, () => decodeUtf8(bd.BB()))
  set('q', DELTA_NONE, () => Array.from(bd.QQ()))
  set('Q', DELTA_NONE, () => bd.QS())
  set('H', DELTA_NONE, () => bd.HC())
  set('P', DELTA_NONE, () => bd.PD())
  set('N', DELTA_ADD_DATA, () => bd.RS())
  set('S', DELTA_SUB_DATA_LENGTH, () => decodeUtf8(SC()))
  return arr
}

function decodeReadFeatures(
  alignmentStart: number,
  readFeatureCount: number,
  bd: BoundDecoders,
  schema: (RFEntry | undefined)[],
): [ReadFeature[], number] {
  let readPos = 0
  let refDelta = 0
  const base = alignmentStart - 1
  const readFeatures: ReadFeature[] = new Array(readFeatureCount)
  const decodeFC = bd.FC
  const decodeFP = bd.FP

  for (let i = 0; i < readFeatureCount; i++) {
    const codeNum = decodeFC()
    readPos += decodeFP()
    const entry = schema[codeNum]

    if (!entry) {
      throw new CramMalformedError(
        `invalid read feature code "${String.fromCharCode(codeNum)}"`,
      )
    }

    const data = entry.decode()

    readFeatures[i] = {
      code: entry.code,
      pos: readPos,
      refPos: readPos + base + refDelta,
      data,
    } as ReadFeature

    const { deltaKind } = entry
    if (deltaKind === DELTA_ADD_DATA) {
      refDelta += data as number
    } else if (deltaKind === DELTA_SUB_DATA_LENGTH) {
      refDelta -= (data as string).length
    } else if (deltaKind === DELTA_SUB_ONE) {
      refDelta -= 1
    }
  }
  return [readFeatures, refDelta]
}

export type BulkByteRawDecoder = (
  dataSeriesName: 'QS' | 'BA',
  length: number,
) => Uint8Array | undefined

function decodeQualityScores(
  readLength: number,
  decodeBulkBytesRaw: BulkByteRawDecoder | undefined,
  decodeQS: () => number,
) {
  const raw = decodeBulkBytesRaw?.('QS', readLength)
  if (raw) {
    return raw
  }
  const out = new Uint8Array(readLength)
  for (let i = 0; i < readLength; i++) {
    out[i] = decodeQS()
  }
  return out
}

function decodeReadBases(
  readLength: number,
  decodeBulkBytesRaw: BulkByteRawDecoder | undefined,
  decodeBA: () => number,
) {
  const raw = decodeBulkBytesRaw?.('BA', readLength)
  if (raw) {
    return decodeUtf8(raw)
  }
  const buf = new Uint8Array(readLength)
  for (let i = 0; i < readLength; i++) {
    buf[i] = decodeBA()
  }
  return decodeUtf8(buf)
}

/**
 * One tag of one tag-list, resolved once per slice: the two-character tag
 * name and its one-character type, split out of the three-character tag id
 * ahead of time so the per-record loop does no string work.
 */
export interface TagDescriptor {
  name: string
  type: string
  decode: () => Uint8Array | number | undefined
}

/**
 * Everything decodeRecord needs that is fixed for the whole slice. Built once
 * in slice/index.ts, which keeps decodeRecord's signature short and hoists the
 * compression-scheme and slice-header lookups out of the per-record path.
 */
export interface SliceDecodeContext {
  bd: BoundDecoders
  rfSchema: (RFEntry | undefined)[]
  /** indexed by TL data series value */
  tagDescriptorsByTL: TagDescriptor[][]
  cursors: Cursors
  decodeBulkBytesRaw: BulkByteRawDecoder | undefined
  decodeTags: boolean
  APdelta: boolean
  readNamesIncluded: boolean
  /** multi-reference slice: each record carries its own RI sequence id */
  isMultiRef: boolean
  /** the slice's reference id, used when not a multi-reference slice */
  refSeqId: number
}

export default function decodeRecord(
  ctx: SliceDecodeContext,
  recordNumber: number,
  uniqueId: number,
) {
  const {
    bd,
    rfSchema,
    tagDescriptorsByTL,
    cursors,
    decodeBulkBytesRaw,
    decodeTags,
    APdelta,
    readNamesIncluded,
    isMultiRef,
    refSeqId,
  } = ctx
  let flags = bd.BF()

  // note: the C data type of compressionFlags is byte in cram v1 and int32 in
  // cram v2+, but that does not matter for us here in javascript land.
  const cramFlags = bd.CF()

  const sequenceId = isMultiRef ? bd.RI() : refSeqId

  const readLength = bd.RL()
  // if APDelta, AP is a delta from the previous record's alignmentStart
  let alignmentStart = bd.AP()
  if (APdelta) {
    alignmentStart = alignmentStart + cursors.lastAlignmentStart
  }
  cursors.lastAlignmentStart = alignmentStart
  const readGroupId = bd.RG()

  let readNameRaw: Uint8Array | undefined
  if (readNamesIncluded) {
    readNameRaw = bd.RN()
  }

  let mate: MateRecord | undefined
  let templateSize: number | undefined
  let mateRecordNumber: number | undefined
  // mate record
  if (CramFlagsDecoder.isDetached(cramFlags)) {
    // note: the MF is a byte in 1.0, int32 in 2+, but once again this doesn't
    // matter for javascript
    const mateFlags = bd.MF()
    let mateReadName: string | undefined
    if (!readNamesIncluded) {
      readNameRaw = bd.RN()
      mateReadName = readNullTerminatedStringFromBuffer(readNameRaw)
    }
    const mateSequenceId = bd.NS()
    const mateAlignmentStart = bd.NP()
    if (mateFlags || mateSequenceId > -1) {
      mate = {
        flags: mateFlags,
        sequenceId: mateSequenceId,
        alignmentStart: mateAlignmentStart,
        readName: mateReadName,
      }
    }

    templateSize = bd.TS()

    // set mate unmapped if needed
    if (MateFlagsDecoder.isUnmapped(mateFlags)) {
      flags = BamFlagsDecoder.setMateUnmapped(flags)
    }
    // set mate reversed if needed
    if (MateFlagsDecoder.isOnNegativeStrand(mateFlags)) {
      flags = BamFlagsDecoder.setMateReverseComplemented(flags)
    }
  } else if (CramFlagsDecoder.isWithMateDownstream(cramFlags)) {
    mateRecordNumber = bd.NF() + recordNumber + 1
  }

  // TODO: the aux tag parsing will have to be refactored if we want to support
  // cram v1
  const TLindex = bd.TL()
  if (TLindex < 0) {
    /* TODO: check nTL: TLindex >= compressionHeader.tagEncoding.size */
    throw new CramMalformedError('invalid TL index')
  }

  type TagValue = string | number | number[] | undefined
  const tags: Record<string, TagValue> = {}
  if (decodeTags) {
    const descriptors = tagDescriptorsByTL[TLindex]
    if (!descriptors) {
      throw new CramMalformedError(
        `TL index ${TLindex} not present in the tag dictionary`,
      )
    }
    for (const descriptor of descriptors) {
      const { name, type, decode } = descriptor
      const tagData = decode()
      tags[name] =
        tagData === undefined
          ? undefined
          : typeof tagData === 'number'
            ? tagData
            : parseTagData(type, tagData)
    }
  }

  let readFeatures: ReadFeature[] | undefined
  let lengthOnRef: number | undefined
  let mappingQuality: number | undefined
  let qualityScores: Uint8Array | undefined | null
  let readBases = undefined
  if (!BamFlagsDecoder.isSegmentUnmapped(flags)) {
    // reading read features
    const readFeatureCount = bd.FN()
    lengthOnRef = readLength
    if (readFeatureCount) {
      const [features, refDelta] = decodeReadFeatures(
        alignmentStart,
        readFeatureCount,
        bd,
        rfSchema,
      )
      readFeatures = features
      lengthOnRef += refDelta
    }
    if (Number.isNaN(lengthOnRef)) {
      console.warn(
        `${sequenceId}:${alignmentStart} record has invalid read features`,
      )
      lengthOnRef = readLength
    }

    // mapping quality
    mappingQuality = bd.MQ()

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
