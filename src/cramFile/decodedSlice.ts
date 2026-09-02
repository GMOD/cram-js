/**
 * One decoded slice, as columns.
 *
 * This is the representation everything else works from: the decode writes
 * into it, the record cache holds it, a worker transfers it, and a
 * {@link CramRecord} is a view onto one index of it. There is deliberately no
 * per-record object anywhere on the path from the file to the cache.
 *
 * Why columns rather than records. The per-record scalars used to become one
 * `CramRecord` each as they decoded, and a worker-decoded slice was then rebuilt
 * record by record on the host, serially — 0.5 µs a record, which on a 54,695
 * record file is a quarter of the whole in-process decode, and the serial term
 * that capped the pool's speedup (docs/workers.md). Packed as columns, a slice
 * arrives from a worker by transfer and is usable as it lands. The columns are
 * also what a decoded slice retains, and they are a fraction of what the
 * objects were: 18 int32 slots plus a byte and a double per record, against a
 * 27-field object.
 *
 * Strings stay strings — read names, the read bases of an unmapped record —
 * because encoding them into bytes was measured to cost more than cloning them
 * (see {@link TagColumn}).
 */
import ReadFeatureArena from './readFeatureArena.ts'
import CramRecord from './record.ts'
import TagColumn from './tagColumn.ts'

import type { CramRecordArgs, RefRegion } from './record.ts'

/**
 * A {@link CramRecord} subclass to hand out in place of the base class — see
 * `CramFileOptions.recordClass`. Constructed the way the base class is, with
 * the slice and an index.
 */
export type CramRecordClass = new (
  slice: DecodedSlice,
  index: number,
) => CramRecord

/** Number of `Int32Array` slots each record occupies in {@link DecodedSlice.scalars}. */
export const SCALAR_STRIDE = 18

/**
 * Offsets within one record's stride. Record-major rather than field-major
 * because a record's fields are read together, so they want to be one cache
 * line's walk apart rather than eighteen strides apart.
 */
// Plain constants rather than a `const enum`: a const enum needs value emission,
// so `node --experimental-strip-types` — which this repo's scripts and profilers
// run under — refuses the file outright.
export const S_FLAGS = 0
export const S_CRAM_FLAGS = 1
export const S_READ_FEATURE_START = 2
export const S_READ_FEATURE_COUNT = 3
export const S_START = 4
export const S_READ_LENGTH = 5
export const S_LENGTH_ON_REF = 6
export const S_TEMPLATE_LENGTH = 7
export const S_TEMPLATE_SIZE = 8
export const S_MATE_RECORD_NUMBER = 9
export const S_NEXT_SEQUENCE_ID = 10
export const S_NEXT_START = 11
export const S_SEQUENCE_ID = 12
export const S_READ_GROUP_ID = 13
export const S_MAPPING_QUALITY = 14
export const S_QUALITY_START = 15
export const S_TAG_START = 16
export const S_TAG_COUNT = 17

/**
 * Which optional scalars a record actually carries, one byte per record.
 *
 * A sentinel value in the scalar column will not do for these: `templateLength`
 * is legitimately negative, `mappingQuality` spans the whole byte range, and
 * `mateRecordNumber` is a valid 0 — so "absent" has to be recorded out of band.
 */
export const P_LENGTH_ON_REF = 1 << 0
export const P_TEMPLATE_LENGTH = 1 << 1
export const P_TEMPLATE_SIZE = 1 << 2
export const P_MAPPING_QUALITY = 1 << 3
export const P_MATE_RECORD_NUMBER = 1 << 4

export default class DecodedSlice {
  recordCount: number
  /** `recordCount * SCALAR_STRIDE` values, see the `S_*` offsets */
  scalars: Int32Array
  /** one `P_*` bitfield per record */
  presence: Uint8Array
  /**
   * `Float64Array`, not `Int32Array`: a uniqueId is derived from the slice's
   * file offset and so runs past 2^31 on any file over 2 GB.
   */
  uniqueIds: Float64Array
  /** sparse: only the records the file, or mate association, gave a name */
  readNames: (string | undefined)[]
  /**
   * Sparse: the bases of a record decoded without a reference. Also where
   * {@link CramRecord.getReadBases} memoizes what it reconstructs, so the memo
   * lives with the slice rather than on a view.
   */
  readBases: (string | undefined)[]
  /** undefined when no record in the slice carried read features */
  arena: ReadFeatureArena | undefined
  /** every quality score in the slice, end to end; see {@link CramRecord.qualityColumn} */
  qualityBytes: Uint8Array | undefined
  tagColumn: TagColumn
  /**
   * The reference region each sequence's records were decorated with, by
   * sequence id. Host-side only: it comes from `fetchReferenceSequence`, which
   * cannot cross into a worker, so a slice arriving from one has none yet.
   * A record reads its own region through {@link CramRecord._refRegion}, which
   * also checks that the region covers the record.
   */
  refRegions: Map<number, RefRegion> | undefined

  constructor(recordCount: number, tagColumn: TagColumn) {
    this.recordCount = recordCount
    this.scalars = new Int32Array(recordCount * SCALAR_STRIDE)
    this.presence = new Uint8Array(recordCount)
    this.uniqueIds = new Float64Array(recordCount)
    this.readNames = new Array<string | undefined>(recordCount)
    this.readBases = new Array<string | undefined>(recordCount)
    this.arena = undefined
    this.qualityBytes = undefined
    this.tagColumn = tagColumn
    this.refRegions = undefined
  }

  /**
   * A view per record, optionally only those `filter` accepts, built with
   * `RecordClass` — a consumer's subclass of {@link CramRecord}, so that a read
   * is one object rather than a record plus a wrapper around it. The views are
   * fresh each call — nothing here retains one, which is what keeps a cached
   * slice at the size of its columns.
   */
  records(
    filter?: (record: CramRecord) => boolean,
    RecordClass: CramRecordClass = CramRecord,
  ) {
    const out: CramRecord[] = []
    for (let i = 0; i < this.recordCount; i++) {
      const record = new RecordClass(this, i)
      if (filter === undefined || filter(record)) {
        out.push(record)
      }
    }
    return out
  }

  /**
   * A one-record slice built from the fields {@link CramRecord}'s constructor
   * has always taken, for callers that synthesise a record rather than decode
   * one.
   */
  static fromRecordArgs(args: CramRecordArgs) {
    const slice = new DecodedSlice(1, args.tagColumn)
    const s = slice.scalars
    let p = 0
    s[S_FLAGS] = args.flags
    s[S_CRAM_FLAGS] = args.cramFlags
    s[S_READ_FEATURE_START] = args.readFeatureStart
    s[S_READ_FEATURE_COUNT] = args.readFeatureCount
    s[S_START] = args.start
    s[S_READ_LENGTH] = args.readLength
    s[S_NEXT_SEQUENCE_ID] = args.nextSequenceId
    s[S_NEXT_START] = args.nextStart
    s[S_SEQUENCE_ID] = args.sequenceId
    s[S_READ_GROUP_ID] = args.readGroupId
    s[S_QUALITY_START] = args.qualityStart
    s[S_TAG_START] = args.tagStart
    s[S_TAG_COUNT] = args.tagCount
    if (args.lengthOnRef !== undefined) {
      s[S_LENGTH_ON_REF] = args.lengthOnRef
      p |= P_LENGTH_ON_REF
    }
    if (args.templateSize !== undefined) {
      s[S_TEMPLATE_SIZE] = args.templateSize
      p |= P_TEMPLATE_SIZE
    }
    if (args.mappingQuality !== undefined) {
      s[S_MAPPING_QUALITY] = args.mappingQuality
      p |= P_MAPPING_QUALITY
    }
    if (args.mateRecordNumber !== undefined) {
      s[S_MATE_RECORD_NUMBER] = args.mateRecordNumber
      p |= P_MATE_RECORD_NUMBER
    }
    slice.presence[0] = p
    slice.uniqueIds[0] = args.uniqueId
    if (args.readName !== undefined) {
      slice.readNames[0] = args.readName
    }
    if (args.readBases) {
      slice.readBases[0] = args.readBases
    }
    slice.arena = args.readFeatureArena
    slice.qualityBytes = args.qualityColumn
    return slice
  }
}

/** The wire form of one decoded slice. Every typed array here is transferable. */
export interface SliceTransfer {
  recordCount: number
  scalars: Int32Array
  presence: Uint8Array
  uniqueIds: Float64Array
  readNames: (string | undefined)[]
  readBases: (string | undefined)[]
  arena: ArenaTransfer | undefined
  qualityBytes: Uint8Array | undefined
  tags: TagTransfer
}

// The column types are taken from the classes rather than restated, so the wire
// form cannot drift from the thing it carries — and so the exact
// `TypedArray<ArrayBuffer>` variance the arena declares survives the round trip.
export interface ArenaTransfer {
  length: number
  payloadLength: number
  codes: ReadFeatureArena['codes']
  pos: ReadFeatureArena['pos']
  refPos: ReadFeatureArena['refPos']
  num: ReadFeatureArena['num']
  payloadChunks: ReadFeatureArena['payloadChunks']
  payloadBytes: ReadFeatureArena['payloadBytes']
  refCodes: ReadFeatureArena['refCodes']
  subCodes: ReadFeatureArena['subCodes']
}

export interface TagTransfer {
  length: number
  keyIds: TagColumn['keyIds']
  kinds: TagColumn['kinds']
  values: TagColumn['values']
  strings: TagColumn['strings']
  arrays: TagColumn['arrays']
  doubles: TagColumn['doubles']
  keyNames: TagColumn['keyNames']
}

/**
 * The payload to `postMessage` and the buffers to transfer with it.
 *
 * **Transfer detaches those buffers**, so the slice passed in is unusable
 * afterwards — which is what the worker wants, since it is done with it.
 * Nothing on the host calls this.
 */
export function serializeSlice(slice: DecodedSlice): {
  payload: SliceTransfer
  transfer: ArrayBuffer[]
} {
  const { arena, tagColumn } = slice
  const payload: SliceTransfer = {
    recordCount: slice.recordCount,
    scalars: slice.scalars,
    presence: slice.presence,
    uniqueIds: slice.uniqueIds,
    readNames: slice.readNames,
    readBases: slice.readBases,
    arena: arena
      ? {
          length: arena.length,
          payloadLength: arena.payloadLength,
          codes: arena.codes,
          pos: arena.pos,
          refPos: arena.refPos,
          num: arena.num,
          payloadChunks: arena.payloadChunks,
          payloadBytes: arena.payloadBytes,
          refCodes: arena.refCodes,
          subCodes: arena.subCodes,
        }
      : undefined,
    qualityBytes: slice.qualityBytes,
    tags: {
      length: tagColumn.length,
      keyIds: tagColumn.keyIds,
      kinds: tagColumn.kinds,
      values: tagColumn.values,
      strings: tagColumn.strings,
      arrays: tagColumn.arrays,
      doubles: tagColumn.doubles,
      keyNames: tagColumn.keyNames,
    },
  }

  // Deduplicated by identity: the quality column can *be* an external block that
  // the arena or another column also points into, and listing one buffer twice
  // makes postMessage throw.
  const buffers = new Set<ArrayBuffer>()
  const add = (v: { buffer: ArrayBufferLike } | undefined) => {
    if (v && v.buffer instanceof ArrayBuffer) {
      buffers.add(v.buffer)
    }
  }
  add(payload.scalars)
  add(payload.presence)
  add(payload.uniqueIds)
  add(payload.tags.keyIds)
  add(payload.tags.kinds)
  add(payload.tags.values)
  add(payload.qualityBytes)
  if (payload.arena) {
    add(payload.arena.codes)
    add(payload.arena.pos)
    add(payload.arena.refPos)
    add(payload.arena.num)
    add(payload.arena.payloadChunks)
    add(payload.arena.payloadBytes)
    add(payload.arena.refCodes)
    add(payload.arena.subCodes)
  }
  return { payload, transfer: [...buffers] }
}

/**
 * The slice a {@link serializeSlice} payload describes. Nothing per record
 * happens here: the columns are adopted as they arrived, and only the two
 * column classes get their prototypes back.
 *
 * The slice comes back **without** its reference decoration — no
 * {@link DecodedSlice.refRegions}, and no `ref`/`sub` in the arena's
 * substitution columns. That stays on the main thread because it needs
 * `fetchReferenceSequence`, which is a caller-supplied callback and cannot
 * cross into a worker.
 */
export function deserializeSlice(payload: SliceTransfer) {
  const slice = new DecodedSlice(0, rebuildTagColumn(payload.tags))
  slice.recordCount = payload.recordCount
  slice.scalars = payload.scalars
  slice.presence = payload.presence
  slice.uniqueIds = payload.uniqueIds
  slice.readNames = payload.readNames
  slice.readBases = payload.readBases
  slice.arena = payload.arena ? rebuildArena(payload.arena) : undefined
  slice.qualityBytes = payload.qualityBytes
  return slice
}

function rebuildArena(t: ArenaTransfer) {
  const arena = new ReadFeatureArena(0)
  arena.length = t.length
  arena.payloadLength = t.payloadLength
  arena.codes = t.codes
  arena.pos = t.pos
  arena.refPos = t.refPos
  arena.num = t.num
  arena.payloadChunks = t.payloadChunks
  // the sender trimmed, so the checkpoints match these columns already
  arena.indexedLength = t.length
  arena.payloadBytes = t.payloadBytes
  arena.refCodes = t.refCodes
  arena.subCodes = t.subCodes
  return arena
}

function rebuildTagColumn(t: TagTransfer) {
  const column = new TagColumn(0)
  column.length = t.length
  column.keyIds = t.keyIds
  column.kinds = t.kinds
  column.values = t.values
  column.strings = t.strings
  column.arrays = t.arrays
  column.doubles = t.doubles
  // rebuilds the private name->id map as a side effect, which getTag needs
  for (const name of t.keyNames) {
    column.keyIdFor(name)
  }
  return column
}
