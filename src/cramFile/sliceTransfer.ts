/**
 * Moving a decoded slice across a worker boundary.
 *
 * A decoded slice is mostly columns already — {@link ReadFeatureArena},
 * {@link TagColumn} and the quality column are typed arrays, which transfer at
 * zero copy. What is left is the per-record scalars, and those are the reason
 * this module exists: handing the `CramRecord[]` to `postMessage` directly is not
 * an option (a class instance loses its prototype, and its getters do not
 * serialise at all), and cloning them as plain objects was measured at **1011 ms
 * against a 392 ms decode** on a 19kb query over 1000x-coverage short reads.
 *
 * So the scalars are packed into one `Int32Array` and reconstructed on the far
 * side. Strings stay strings: `structuredClone` moves 153,677 of them in 15 ms,
 * against 112 ms to encode the same set into bytes, so encoding them would cost
 * more than it saves (measured — see the note in {@link TagColumn}).
 */
import ReadFeatureArena from './readFeatureArena.ts'
import CramRecord from './record.ts'
import TagColumn from './tagColumn.ts'

/** Number of `Int32Array` slots each record occupies in the `S_*` offsets below. */
const SCALAR_STRIDE = 18

/**
 * Offsets within one record's stride. Record-major rather than field-major
 * because the deserialise loop builds one whole record at a time, so a record's
 * eighteen values want to be one cache line's walk apart rather than eighteen
 * strides apart.
 */
// Plain constants rather than a `const enum`: a const enum needs value emission,
// so `node --experimental-strip-types` — which this repo's scripts and profilers
// run under — refuses the file outright.
const S_FLAGS = 0
const S_CRAM_FLAGS = 1
const S_READ_FEATURE_START = 2
const S_READ_FEATURE_COUNT = 3
const S_START = 4
const S_READ_LENGTH = 5
const S_LENGTH_ON_REF = 6
const S_TEMPLATE_LENGTH = 7
const S_TEMPLATE_SIZE = 8
const S_MATE_RECORD_NUMBER = 9
const S_NEXT_SEQUENCE_ID = 10
const S_NEXT_START = 11
const S_SEQUENCE_ID = 12
const S_READ_GROUP_ID = 13
const S_MAPPING_QUALITY = 14
const S_QUALITY_START = 15
const S_TAG_START = 16
const S_TAG_COUNT = 17

/**
 * Which optional fields a record actually carries, one byte per record.
 *
 * A sentinel value in the scalar column will not do for these: `templateLength`
 * is legitimately negative, `mappingQuality` spans the whole byte range, and
 * `mateRecordNumber` is a valid 0 — so "absent" has to be recorded out of band.
 * Eight flags fit one byte exactly, which is why `readBases`' three states are
 * two bits rather than a third column.
 */
const P_LENGTH_ON_REF = 1 << 0
const P_TEMPLATE_LENGTH = 1 << 1
const P_TEMPLATE_SIZE = 1 << 2
const P_MAPPING_QUALITY = 1 << 3
const P_MATE_RECORD_NUMBER = 1 << 4
/** `readBases` is a string, held in {@link SliceTransfer.readBases} */
const P_READ_BASES_STRING = 1 << 5
/** `readBases` is `null` — a `*` record, which is not the same as absent */
const P_READ_BASES_NULL = 1 << 6
const P_READ_NAME = 1 << 7

/** The wire form of one decoded slice. Every typed array here is transferable. */
export interface SliceTransfer {
  recordCount: number
  /** `recordCount * SCALAR_STRIDE` values, see the `S_*` offsets below */
  scalars: Int32Array
  /**
   * One `P_*` bitfield per record.
   *
   * Separate from {@link scalars} rather than folded into it as a 19th slot,
   * because it is a byte and the rest are 4 bytes: one `Uint8Array` costs
   * `recordCount` bytes where a shared Int32 slot would cost four times that.
   */
  presence: Uint8Array
  /**
   * uniqueId per record. `Float64Array`, not `Int32Array`: a uniqueId is derived
   * from the slice's file offset (`contentPosition + recordCounter + 1`) and so
   * runs past 2^31 on any file over 2 GB.
   */
  uniqueIds: Float64Array
  /** sparse — only where `P_READ_NAME` is set */
  readNames: (string | undefined)[]
  /** sparse — only where `P_READ_BASES_STRING` is set */
  readBases: (string | undefined)[]
  /** undefined when no record in the slice carried read features */
  arena: ArenaTransfer | undefined
  /** undefined when no record in the slice carried quality scores */
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

function sliceMismatch(what: string) {
  return (
    `serializeSliceRecords was given records from more than one slice (${what} differ). ` +
    "It packs one slice, against that slice's single set of columns; serialise each slice separately."
  )
}

/**
 * Pack **one slice's** decoded records for `postMessage`.
 *
 * Returns the payload and the list of buffers to transfer with it. **Transfer
 * detaches those buffers**, so the records passed in are unusable afterwards —
 * which is what the worker wants (it is done with them) and why the main-thread
 * fallback path must not call this.
 *
 * Throws if handed records spanning several slices; see the guard in the loop.
 */
export function serializeSliceRecords(records: CramRecord[]): {
  payload: SliceTransfer
  transfer: ArrayBuffer[]
} {
  const n = records.length
  const scalars = new Int32Array(n * SCALAR_STRIDE)
  const presence = new Uint8Array(n)
  const uniqueIds = new Float64Array(n)
  const readNames: (string | undefined)[] = new Array(n)
  const readBases: (string | undefined)[] = new Array(n)

  // Every record in a slice shares one arena, tag column and quality column, so
  // these are found once from whichever record has them rather than per record.
  let arena: ReadFeatureArena | undefined
  let qualityBytes: Uint8Array | undefined
  let tagColumn: TagColumn | undefined

  for (let i = 0; i < n; i++) {
    const r = records[i]!
    const o = i * SCALAR_STRIDE
    let p = 0

    scalars[o + S_FLAGS] = r.flags
    scalars[o + S_CRAM_FLAGS] = r.cramFlags
    scalars[o + S_READ_FEATURE_START] = r.readFeatureStart
    scalars[o + S_READ_FEATURE_COUNT] = r.readFeatureCount
    scalars[o + S_START] = r.start
    scalars[o + S_READ_LENGTH] = r.readLength
    scalars[o + S_NEXT_SEQUENCE_ID] = r.nextSequenceId
    scalars[o + S_NEXT_START] = r.nextStart
    scalars[o + S_SEQUENCE_ID] = r.sequenceId
    scalars[o + S_READ_GROUP_ID] = r.readGroupId
    scalars[o + S_QUALITY_START] = r.qualityStart
    scalars[o + S_TAG_START] = r.tagStart
    scalars[o + S_TAG_COUNT] = r.tagCount
    uniqueIds[i] = r.uniqueId

    if (r.lengthOnRef !== undefined) {
      scalars[o + S_LENGTH_ON_REF] = r.lengthOnRef
      p |= P_LENGTH_ON_REF
    }
    if (r.templateLength !== undefined) {
      scalars[o + S_TEMPLATE_LENGTH] = r.templateLength
      p |= P_TEMPLATE_LENGTH
    }
    if (r.templateSize !== undefined) {
      scalars[o + S_TEMPLATE_SIZE] = r.templateSize
      p |= P_TEMPLATE_SIZE
    }
    if (r.mappingQuality !== undefined) {
      scalars[o + S_MAPPING_QUALITY] = r.mappingQuality
      p |= P_MAPPING_QUALITY
    }
    if (r.mateRecordNumber !== undefined) {
      scalars[o + S_MATE_RECORD_NUMBER] = r.mateRecordNumber
      p |= P_MATE_RECORD_NUMBER
    }
    if (r.readName !== undefined) {
      readNames[i] = r.readName
      p |= P_READ_NAME
    }
    if (typeof r.readBases === 'string') {
      readBases[i] = r.readBases
      p |= P_READ_BASES_STRING
    } else if (r.readBases === null) {
      p |= P_READ_BASES_NULL
    }
    presence[i] = p

    // One slice has exactly one of each of these, shared by every record in it,
    // so they are found once rather than per record.
    //
    // The guard is not paranoia. `IndexedCramFile.getRecordsForRange` hands back
    // the records of *every* slice covering the query, each with its own columns,
    // and quietly serialising that array against the first slice's columns
    // produces records whose quality scores and read features are read out of the
    // wrong arrays — plausible-looking garbage rather than an error. Serialise one
    // slice at a time.
    if (r.readFeatureArena !== undefined) {
      arena ??= r.readFeatureArena
      if (arena !== r.readFeatureArena) {
        throw new Error(sliceMismatch('read-feature arenas'))
      }
    }
    if (r.qualityColumn !== undefined) {
      qualityBytes ??= r.qualityColumn
      if (qualityBytes !== r.qualityColumn) {
        throw new Error(sliceMismatch('quality columns'))
      }
    }
    tagColumn ??= r.tagColumn
    if (tagColumn !== r.tagColumn) {
      throw new Error(sliceMismatch('tag columns'))
    }
  }

  // A slice always has a tag column object even when tags were not decoded, so
  // this only fails for an empty slice, which has nothing to send either.
  const tags: TagTransfer = tagColumn
    ? {
        length: tagColumn.length,
        keyIds: tagColumn.keyIds,
        kinds: tagColumn.kinds,
        values: tagColumn.values,
        strings: tagColumn.strings,
        arrays: tagColumn.arrays,
        doubles: tagColumn.doubles,
        keyNames: tagColumn.keyNames,
      }
    : {
        length: 0,
        keyIds: new Uint16Array(0),
        kinds: new Uint8Array(0),
        values: new Int32Array(0),
        strings: [],
        arrays: [],
        doubles: [],
        keyNames: [],
      }

  const arenaTransfer: ArenaTransfer | undefined = arena
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
    : undefined

  const payload: SliceTransfer = {
    recordCount: n,
    scalars,
    presence,
    uniqueIds,
    readNames,
    readBases,
    arena: arenaTransfer,
    qualityBytes,
    tags,
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
  add(scalars)
  add(presence)
  add(uniqueIds)
  add(tags.keyIds)
  add(tags.kinds)
  add(tags.values)
  add(qualityBytes)
  if (arenaTransfer) {
    add(arenaTransfer.codes)
    add(arenaTransfer.pos)
    add(arenaTransfer.refPos)
    add(arenaTransfer.num)
    add(arenaTransfer.payloadChunks)
    add(arenaTransfer.payloadBytes)
    add(arenaTransfer.refCodes)
    add(arenaTransfer.subCodes)
  }

  return { payload, transfer: [...buffers] }
}

/**
 * Rebuild the `CramRecord[]` a {@link serializeSliceRecords} payload describes.
 *
 * The records come back **without** their reference decoration — no `_refRegion`,
 * and no `ref`/`sub` in the arena's substitution columns. That stays on the main
 * thread because it needs `fetchReferenceSequence`, which is a caller-supplied
 * callback and cannot cross into a worker.
 */
export function deserializeSliceRecords(payload: SliceTransfer): CramRecord[] {
  const {
    recordCount,
    scalars,
    presence,
    uniqueIds,
    readNames,
    readBases,
    arena: at,
    qualityBytes,
    tags,
  } = payload

  const arena = at ? rebuildArena(at) : undefined
  const tagColumn = rebuildTagColumn(tags)

  const records: CramRecord[] = new Array(recordCount)
  for (let i = 0; i < recordCount; i++) {
    const o = i * SCALAR_STRIDE
    const p = presence[i]!
    const readFeatureCount = scalars[o + S_READ_FEATURE_COUNT]!
    const qualityStart = scalars[o + S_QUALITY_START]!
    records[i] = new CramRecord({
      flags: scalars[o + S_FLAGS]!,
      cramFlags: scalars[o + S_CRAM_FLAGS]!,
      // presence is derived rather than flagged: the decode gives a record an
      // arena only when it has features, and a quality column only when
      // qualityStart is non-negative
      readFeatureArena: readFeatureCount > 0 ? arena : undefined,
      readFeatureStart: scalars[o + S_READ_FEATURE_START]!,
      readFeatureCount,
      start: scalars[o + S_START]!,
      readLength: scalars[o + S_READ_LENGTH]!,
      lengthOnRef:
        p & P_LENGTH_ON_REF ? scalars[o + S_LENGTH_ON_REF]! : undefined,
      templateSize:
        p & P_TEMPLATE_SIZE ? scalars[o + S_TEMPLATE_SIZE]! : undefined,
      mateRecordNumber:
        p & P_MATE_RECORD_NUMBER
          ? scalars[o + S_MATE_RECORD_NUMBER]!
          : undefined,
      nextSequenceId: scalars[o + S_NEXT_SEQUENCE_ID]!,
      nextStart: scalars[o + S_NEXT_START]!,
      sequenceId: scalars[o + S_SEQUENCE_ID]!,
      readGroupId: scalars[o + S_READ_GROUP_ID]!,
      mappingQuality:
        p & P_MAPPING_QUALITY ? scalars[o + S_MAPPING_QUALITY]! : undefined,
      qualityColumn: qualityStart < 0 ? undefined : qualityBytes,
      qualityStart,
      readName: p & P_READ_NAME ? readNames[i] : undefined,
      readBases:
        p & P_READ_BASES_STRING
          ? readBases[i]
          : p & P_READ_BASES_NULL
            ? null
            : undefined,
      tagColumn,
      tagStart: scalars[o + S_TAG_START]!,
      tagCount: scalars[o + S_TAG_COUNT]!,
      uniqueId: uniqueIds[i]!,
    })
    // templateLength is not a constructor parameter — mate association computes
    // it after the fact — so it is assigned here for the same reason
    if (p & P_TEMPLATE_LENGTH) {
      records[i]!.templateLength = scalars[o + S_TEMPLATE_LENGTH]!
    }
  }
  return records
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
