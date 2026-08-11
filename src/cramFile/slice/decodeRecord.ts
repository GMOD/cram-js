import { CramMalformedError } from '../../errors.ts'
import Constants from '../constants.ts'
import { readQualityScores } from '../qualityColumn.ts'
import { NO_MATE, type ReadFeature } from '../record.ts'
import { decodeUtf8, readNullTerminatedStringFromBuffer } from '../util.ts'

import type { Cursors } from '../codecs/_base.ts'
import type { DataSeriesEncodingKey } from '../codecs/dataSeriesTypes.ts'
import type { DataSeriesTypes } from '../container/compressionScheme.ts'
import type { QualityColumn } from '../qualityColumn.ts'
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

export function parseTagData(tagType: string, buffer: Uint8Array) {
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

// Read-feature schema: a charCode-indexed array of decoders that read the
// feature's payload straight into an arena slot and return how far that feature
// advances the reference position relative to the read. Built once per slice,
// so the inner loop becomes a charCode lookup plus a monomorphic call — and
// folding the reference delta into the return value replaces what used to be a
// per-feature branch on the feature's kind.
export type RFDecoder = (arena: ReadFeatureArena, index: number) => number

export function buildRFSchema(
  bd: BoundDecoders,
  majorVersion: number,
): (RFDecoder | undefined)[] {
  const SC = majorVersion > 1 ? bd.SC : bd.IN
  // filled rather than left sparse: a holey array degrades every lookup in the
  // decode loop below
  const arr: (RFDecoder | undefined)[] = new Array(128).fill(undefined)
  const set = (code: ReadFeature['code'], decodeInto: RFDecoder) => {
    arr[code.charCodeAt(0)] = decodeInto
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
  schema: (RFDecoder | undefined)[],
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
    const decodeInto = schema[codeNum]

    if (!decodeInto) {
      throw new CramMalformedError(
        `invalid read feature code "${String.fromCharCode(codeNum)}"`,
      )
    }

    codes[i] = codeNum
    pos[i] = readPos - 1
    refPos[i] = readPos + base + refDelta
    refDelta += decodeInto(arena, i)
  }
  arena.length = start + readFeatureCount
  return [start, refDelta]
}

/** Reads `length` read bases at once, when the BA codec can hand out a view. */
export type BulkBasesDecoder = (length: number) => Uint8Array | undefined

function decodeReadBases(
  readLength: number,
  decodeBulkBases: BulkBasesDecoder | undefined,
  decodeBA: () => number,
) {
  const raw = decodeBulkBases?.(readLength)
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
export type TagValue = string | number | number[] | undefined

export interface TagDescriptor {
  name: string
  /**
   * The tag's value for the next record, with its type already resolved — see
   * `bindTagDecoders`. The type is fixed for the slice, so dispatching on it
   * belongs there rather than in the record loop.
   */
  read: () => TagValue
}

/**
 * Everything decodeRecord needs that is fixed for the whole slice. Built once
 * in slice/index.ts, which keeps decodeRecord's signature short and hoists the
 * compression-scheme and slice-header lookups out of the per-record path.
 */
export interface SliceDecodeContext {
  bd: BoundDecoders
  rfSchema: (RFDecoder | undefined)[]
  /** columnar read-feature storage shared by every record in the slice */
  arena: ReadFeatureArena
  /** columnar quality-score storage shared by every record in the slice */
  qualityColumn: QualityColumn
  /** indexed by TL data series value */
  tagDescriptorsByTL: TagDescriptor[][]
  cursors: Cursors
  decodeBulkBases: BulkBasesDecoder | undefined
  /** reads the next read name, batched over the whole block where it can be */
  decodeReadName: () => string
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
    qualityColumn,
    tagDescriptorsByTL,
    cursors,
    decodeBulkBases,
    decodeReadName,
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

  // decoded here rather than deferred behind the raw bytes: a retained
  // Uint8Array view is ~104 bytes against ~56 for the name it holds, so keeping
  // one per record to avoid a decode costs almost twice what the decode saves
  let readName: string | undefined
  if (readNamesIncluded) {
    readName = decodeReadName()
  }

  let mateSequenceId = NO_MATE
  let mateStart = -1
  let templateSize: number | undefined
  let mateRecordNumber: number | undefined
  // mate record
  if (cramFlags & Constants.CRAM_FLAG_DETACHED) {
    // note: the MF is a byte in 1.0, int32 in 2+, but once again this doesn't
    // matter for javascript
    const mateFlags = bd.MF()
    if (!readNamesIncluded) {
      // the two mates of a pair share a name, so this is the record's own name
      // as well — one string rather than the two the deferred path decoded
      readName = decodeReadName()
    }
    const declaredSequenceId = bd.NS()
    // NP is an absolute 1-based position, never a delta
    const declaredStart = bd.NP() - 1
    // a nonzero MF means the mate exists even when NS is -1, i.e. it is
    // unplaced — kept apart from NO_MATE, see the constant's note
    if (mateFlags || declaredSequenceId > -1) {
      mateSequenceId = declaredSequenceId
      mateStart = declaredStart
    }

    templateSize = bd.TS()

    // set mate unmapped if needed
    if (mateFlags & Constants.CRAM_M_UNMAP) {
      flags |= Constants.BAM_FMUNMAP
    }
    // set mate reversed if needed
    if (mateFlags & Constants.CRAM_M_REVERSE) {
      flags |= Constants.BAM_FMREVERSE
    }
  } else if (cramFlags & Constants.CRAM_FLAG_MATE_DOWNSTREAM) {
    mateRecordNumber = bd.NF() + recordNumber + 1
  }

  // TODO: the aux tag parsing will have to be refactored if we want to support
  // cram v1
  const TLindex = bd.TL()
  if (TLindex < 0) {
    /* TODO: check nTL: TLindex >= compressionHeader.tagEncoding.size */
    throw new CramMalformedError('invalid TL index')
  }

  const tags: Record<string, TagValue> = {}
  if (decodeTags) {
    const descriptors = tagDescriptorsByTL[TLindex]
    if (!descriptors) {
      throw new CramMalformedError(
        `TL index ${TLindex} not present in the tag dictionary`,
      )
    }
    for (const descriptor of descriptors) {
      tags[descriptor.name] = descriptor.read()
    }
  }

  let readFeatureArena: ReadFeatureArena | undefined
  let readFeatureStart = 0
  let readFeatureCount = 0
  let lengthOnRef: number | undefined
  let mappingQuality: number | undefined
  // offset of this record's scores in the slice's quality column, -1 for a
  // record that carries none
  let qualityStart = -1
  let readBases = undefined
  if (!(flags & Constants.BAM_FUNMAP)) {
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

    if (cramFlags & Constants.CRAM_FLAG_PRESERVE_QUAL_SCORES) {
      qualityStart = readQualityScores(qualityColumn, readLength, bd.QS)
    }
  } else if (cramFlags & Constants.CRAM_FLAG_NO_SEQ) {
    // a '*' record carries neither bases nor scores; CramRecord.qualityScores
    // reads that back off the flags rather than storing a null
    readBases = null
  } else {
    readBases = decodeReadBases(readLength, decodeBulkBases, bd.BA)
    if (cramFlags & Constants.CRAM_FLAG_PRESERVE_QUAL_SCORES) {
      qualityStart = readQualityScores(qualityColumn, readLength, bd.QS)
    }
  }

  return {
    readLength,
    sequenceId,
    cramFlags,
    flags,
    start: alignmentStart,
    readGroupId,
    readName,
    mateSequenceId,
    mateStart,
    templateSize,
    mateRecordNumber,
    readFeatureArena,
    readFeatureStart,
    readFeatureCount,
    lengthOnRef,
    mappingQuality,
    // the column array itself rather than the QualityColumn, so that reading a
    // record's scores is one property hop; a growable column is re-pointed
    // after the slice finishes decoding
    qualityColumn: qualityStart < 0 ? undefined : qualityColumn.bytes,
    qualityStart,
    readBases,
    tags,
    uniqueId,
  }
}
