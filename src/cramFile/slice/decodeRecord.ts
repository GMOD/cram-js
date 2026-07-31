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
import type ReadFeatureArena from '../readFeatureArena.ts'

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

// Read-feature schema: a charCode-indexed array of entries whose decodeInto()
// reads the feature's payload straight into an arena slot and returns how far
// that feature advances the reference position relative to the read. Built once
// per slice, so the inner loop becomes a charCode lookup plus a monomorphic
// call — and folding the reference delta into the return value replaces what
// used to be a per-feature branch on the feature's kind.
export interface RFEntry {
  code: ReadFeature['code']
  decodeInto: (arena: ReadFeatureArena, index: number) => number
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
    decodeInto: RFEntry['decodeInto'],
  ) => {
    arr[code.charCodeAt(0)] = { code, decodeInto }
  }
  // I, S, b, q: a byte-array payload whose length is what `num` records
  const setBytes = (a: ReadFeatureArena, i: number, bytes: Uint8Array) => {
    a.setPayload(i, bytes)
    a.num[i] = bytes.length
    return bytes.length
  }
  set('B', (a, i) => {
    a.setPayloadByte(i, bd.BA())
    a.num[i] = bd.QS()
    return 0
  })
  set('X', (a, i) => {
    a.num[i] = bd.BS()
    return 0
  })
  set('D', (a, i) => {
    const deleted = bd.DL()
    a.num[i] = deleted
    return deleted
  })
  set('N', (a, i) => {
    const skipped = bd.RS()
    a.num[i] = skipped
    return skipped
  })
  set('I', (a, i) => -setBytes(a, i, bd.IN()))
  set('S', (a, i) => -setBytes(a, i, SC()))
  set('b', (a, i) => {
    setBytes(a, i, bd.BB())
    return 0
  })
  set('q', (a, i) => {
    setBytes(a, i, bd.QQ())
    return 0
  })
  set('i', (a, i) => {
    a.setPayloadByte(i, bd.BA())
    a.num[i] = 1
    return -1
  })
  set('Q', (a, i) => {
    a.num[i] = bd.QS()
    return 0
  })
  set('H', (a, i) => {
    a.num[i] = bd.HC()
    return 0
  })
  set('P', (a, i) => {
    a.num[i] = bd.PD()
    return 0
  })
  return arr
}

/**
 * Decode this record's read features into `arena`, returning the slot range
 * they occupy and their total effect on the record's length on the reference.
 */
function decodeReadFeatures(
  recordStart: number,
  readFeatureCount: number,
  bd: BoundDecoders,
  schema: (RFEntry | undefined)[],
  arena: ReadFeatureArena,
): [number, number] {
  let readPos = 0
  let refDelta = 0
  // FP decodes to a 1-based read position, so `readPos - 1` is the 0-based one
  // and `recordStart - 1` absorbs that subtraction for the reference column
  const base = recordStart - 1
  const decodeFC = bd.FC
  const decodeFP = bd.FP

  const start = arena.length
  arena.reserve(readFeatureCount)
  // read after reserve(): growing the arena replaces the column arrays
  const { codes, pos, refPos } = arena

  for (let i = start; i < start + readFeatureCount; i++) {
    const codeNum = decodeFC()
    readPos += decodeFP()
    const entry = schema[codeNum]

    if (!entry) {
      throw new CramMalformedError(
        `invalid read feature code "${String.fromCharCode(codeNum)}"`,
      )
    }

    codes[i] = codeNum
    pos[i] = readPos - 1
    refPos[i] = readPos + base + refDelta
    refDelta += entry.decodeInto(arena, i)
  }
  arena.length = start + readFeatureCount
  return [start, refDelta]
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
  /** columnar read-feature storage shared by every record in the slice */
  arena: ReadFeatureArena
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
    arena,
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
  // if APDelta, AP is a delta from the previous record's start and carries no
  // origin of its own — the 0-based seed comes from the slice header's
  // refSeqStart. Otherwise AP is an absolute 1-based position and converts here.
  const alignmentStart = APdelta
    ? bd.AP() + cursors.lastAlignmentStart
    : bd.AP() - 1
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
    // NP is an absolute 1-based position, never a delta
    const mateAlignmentStart = bd.NP() - 1
    if (mateFlags || mateSequenceId > -1) {
      mate = {
        flags: mateFlags,
        sequenceId: mateSequenceId,
        start: mateAlignmentStart,
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

  let readFeatureArena: ReadFeatureArena | undefined
  let readFeatureStart = 0
  let readFeatureCount = 0
  let lengthOnRef: number | undefined
  let mappingQuality: number | undefined
  let qualityScores: Uint8Array | undefined | null
  let readBases = undefined
  if (!BamFlagsDecoder.isSegmentUnmapped(flags)) {
    // reading read features
    const encodedFeatureCount = bd.FN()
    lengthOnRef = readLength
    if (encodedFeatureCount) {
      const [start, refDelta] = decodeReadFeatures(
        alignmentStart,
        encodedFeatureCount,
        bd,
        rfSchema,
        arena,
      )
      readFeatureArena = arena
      readFeatureStart = start
      readFeatureCount = encodedFeatureCount
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
    start: alignmentStart,
    readGroupId,
    readNameRaw,
    mate,
    templateSize,
    mateRecordNumber,
    readFeatureArena,
    readFeatureStart,
    readFeatureCount,
    lengthOnRef,
    mappingQuality,
    qualityScores,
    readBases,
    tags,
    uniqueId,
  }
}
