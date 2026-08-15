import { grow, nextCapacity } from './growableColumn.ts'
import { decodeUtf8 } from './util.ts'

import type { ReadFeature } from './record.ts'

/**
 * Read-feature codes as the ASCII char codes a {@link ReadFeatureArena} stores
 * in its `codes` column. See CRAMv3 §10.2 (Read features):
 * https://samtools.github.io/hts-specs/CRAMv3.pdf
 */
export const RF_BASE_QUAL = 0x42 // 'B' read base plus quality score
export const RF_DELETION = 0x44 // 'D'
export const RF_HARD_CLIP = 0x48 // 'H'
export const RF_INSERTION = 0x49 // 'I'
export const RF_REF_SKIP = 0x4e // 'N'
export const RF_PADDING = 0x50 // 'P'
export const RF_QUAL = 0x51 // 'Q' single quality score
export const RF_SOFT_CLIP = 0x53 // 'S'
export const RF_SUBST = 0x58 // 'X' base substitution
export const RF_BASES = 0x62 // 'b' verbatim stretch of bases
export const RF_INSERT_BASE = 0x69 // 'i' single-base insertion
export const RF_QUALS = 0x71 // 'q' stretch of quality scores

/**
 * 1 for the feature codes whose `refPos` describes where the feature sits in the
 * alignment, 0 for the quality-only codes q and Q.
 *
 * Any walk that carries a position from one feature to the next must consult
 * this. A q/Q feature gets its `refPos` from the same
 * `readPos + alignmentStart - 1 + refDelta` every other feature does, but the
 * quality of an *inserted* base is recorded at a read position the reference
 * never reaches, so the value points back into the insertion — a Q after a
 * 2-base insertion sits two bases behind the feature before it. Feed one to a
 * position-tracking walk and it emits a negative match run, or flushes a
 * pending insertion early and splits it in two.
 */
export const RF_POSITIONAL = new Uint8Array(128)
for (const code of [
  RF_BASE_QUAL,
  RF_BASES,
  RF_DELETION,
  RF_HARD_CLIP,
  RF_INSERTION,
  RF_INSERT_BASE,
  RF_PADDING,
  RF_REF_SKIP,
  RF_SOFT_CLIP,
  RF_SUBST,
]) {
  RF_POSITIONAL[code] = 1
}

const INITIAL_SLOTS = 1024
const INITIAL_PAYLOAD_BYTES = 1024

/** {@link RF_PAYLOAD}: exactly one byte, since `num` is B's quality score */
export const PAYLOAD_ONE_BYTE = 1
/** {@link RF_PAYLOAD}: `num` bytes */
export const PAYLOAD_NUM = 2

/**
 * How many bytes of {@link ReadFeatureArena.payloadBytes} a slot occupies, by
 * feature code — 0 for the codes carrying none, which is what the table is left
 * at. This is what makes {@link ReadFeatureArena.payloadChunks} possible, since
 * it means a slot's payload length is already on the record.
 *
 * `i` is `num` like the rest rather than a second one-byte case: the decoder
 * writes `num = 1` for it, so the two agree. B is the only code whose `num` is
 * something other than a length.
 *
 * Exported for the walks that track the offset themselves: the values are
 * chosen so that `kind === PAYLOAD_NUM ? num[i] : kind` is the length, since
 * {@link PAYLOAD_ONE_BYTE} is 1 and a code with no payload is 0.
 */
export const RF_PAYLOAD = new Uint8Array(128)
RF_PAYLOAD[RF_BASE_QUAL] = PAYLOAD_ONE_BYTE
for (const code of [
  RF_BASES,
  RF_INSERTION,
  RF_INSERT_BASE,
  RF_QUALS,
  RF_SOFT_CLIP,
]) {
  RF_PAYLOAD[code] = PAYLOAD_NUM
}

/**
 * Slots per entry in {@link ReadFeatureArena.payloadChunks}.
 *
 * Eight puts the checkpoints at half a byte per slot and bounds a lookup at
 * seven steps. The column it replaced was a full `Int32Array` offset per slot:
 * 834 KB on the ONT slice against 104 KB here, and three quarters of it indexed
 * nothing, since only 24.9% of that slice's features carry bytes at all.
 */
const PAYLOAD_CHUNK_SHIFT = 3
const PAYLOAD_CHUNK_SLOTS = 1 << PAYLOAD_CHUNK_SHIFT

/** checkpoints needed to cover `slots` slots */
function chunksFor(slots: number) {
  return (slots + PAYLOAD_CHUNK_SLOTS - 1) >> PAYLOAD_CHUNK_SHIFT
}

/**
 * Struct-of-arrays storage for the read features of every record in one slice.
 *
 * Read features are the dominant term in decoded-record memory on long-read
 * data — a 37-record ONT slice decodes 213k of them — and an
 * `{code, pos, refPos, data}` object costs 64 bytes before
 * `addReferenceSequence` widens the substitutions to 81. Here each feature is
 * 15 bytes of typed-array columns, plus its share of {@link payloadChunks}, and
 * the fixed per-array overhead is amortised across the whole slice.
 *
 * The columns are deliberately *per slice*, not per record: giving each record
 * its own typed arrays makes short-read files about twice as expensive as
 * array-of-structs, because ~100 bytes of fixed `Uint8Array`/`Int32Array`
 * overhead lands on every one of the ~2 features a short read carries.
 *
 * A record occupies the half-open slot range
 * `[record.readFeatureStart, record.readFeatureStart + record.readFeatureCount)`.
 *
 * **Size it up front where the slice says how.** The constructor's arguments are
 * capacities, and `slice/decodeContext.ts` reads exact ones off the slice's own
 * blocks — see `readFeatureCapacity` there. Growing means copying seven columns,
 * and it is the arena, not the record loop, that a long-read slice spends its
 * reallocation time in.
 */
export default class ReadFeatureArena {
  /** feature code as an ASCII char code — one of the `RF_*` constants */
  codes: Uint8Array
  /** 1-based position of the feature in the read */
  pos: Int32Array
  /**
   * 1-based position of the feature on the reference — but only meaningful for
   * the codes {@link RF_POSITIONAL} marks; see there before walking this column.
   */
  refPos: Int32Array
  /**
   * The feature's numeric payload: the data value for D/N/H/P/Q, the
   * substitution-matrix index for X, the quality score for B, and the byte
   * length of the payload for I/S/b/i/q.
   */
  num: Int32Array
  /**
   * The offset into {@link payloadBytes} of every
   * {@link PAYLOAD_CHUNK_SLOTS}-th slot, from which {@link payloadOffsetAt}
   * derives the rest. Built by {@link trim}, once the slice is decoded.
   *
   * A per-slot offset column was the obvious layout and is pure redundancy:
   * payloads are appended in slot order and a slot's length is already known
   * from its code and `num` (see {@link RF_PAYLOAD}), so the offsets are a
   * running prefix sum — checked over every slot of all three performance
   * fixtures, at zero deviations. What the column bought was O(1) random
   * access, which this keeps to within seven steps for an eighth of the memory.
   */
  payloadChunks: Int32Array
  /**
   * The {@link length} {@link payloadChunks} was built for, so that a read
   * against an arena still being filled rebuilds rather than answering from a
   * stale index. −1 marks it as never built.
   *
   * Public for the same reason every column here is: `sliceTransfer` rebuilds
   * an arena field by field, and one arriving from a worker is already indexed.
   */
  indexedLength = -1
  /**
   * Concatenated raw bytes of the features that carry a byte payload — the
   * inserted/clipped/verbatim bases of I/S/b/i, the quality scores of q, and
   * the single base of B. Kept as bytes rather than strings so that consumers
   * needing only a length (`num`) never pay for a string.
   */
  payloadBytes: Uint8Array
  payloadLength = 0
  /**
   * Reference base char code for each X feature, 0 where the reference is not
   * known. Filled by `CramRecord.addReferenceSequence`; that this is a byte
   * column rather than a `ref` string property added to a feature object after
   * construction is worth 11.7% of retained heap on its own, since assigning a
   * property the object was not constructed with moves V8's properties to an
   * out-of-object backing store.
   */
  refCodes: Uint8Array
  /** substituted base char code for each X feature, 0 where not known */
  subCodes: Uint8Array
  /** number of slots in use */
  length = 0

  constructor(slots = INITIAL_SLOTS, payloadBytes = INITIAL_PAYLOAD_BYTES) {
    this.codes = new Uint8Array(slots)
    this.pos = new Int32Array(slots)
    this.refPos = new Int32Array(slots)
    this.num = new Int32Array(slots)
    this.payloadChunks = new Int32Array(chunksFor(slots))
    this.refCodes = new Uint8Array(slots)
    this.subCodes = new Uint8Array(slots)
    this.payloadBytes = new Uint8Array(payloadBytes)
  }

  /**
   * Make room for `additional` more features. Replaces the column arrays when
   * it grows, so callers must re-read them afterwards.
   */
  reserve(additional: number) {
    const needed = this.length + additional
    if (needed > this.codes.length) {
      const capacity = nextCapacity(this.codes.length, needed)
      this.codes = grow(this.codes, capacity)
      this.pos = grow(this.pos, capacity)
      this.refPos = grow(this.refPos, capacity)
      this.num = grow(this.num, capacity)
      this.refCodes = grow(this.refCodes, capacity)
      this.subCodes = grow(this.subCodes, capacity)
    }
  }

  private reservePayload(additional: number) {
    const needed = this.payloadLength + additional
    if (needed > this.payloadBytes.length) {
      this.payloadBytes = grow(
        this.payloadBytes,
        nextCapacity(this.payloadBytes.length, needed),
      )
    }
  }

  /**
   * Record `bytes` as slot `index`'s byte payload. Does not set `num`.
   *
   * `index` is taken for the assertion it documents rather than used: payloads
   * go to the end of {@link payloadBytes}, and {@link payloadOffsetAt} depends
   * on them being appended in slot order.
   */
  setPayload(index: number, bytes: Uint8Array) {
    this.reservePayload(bytes.length)
    this.payloadBytes.set(bytes, this.payloadLength)
    this.payloadLength += bytes.length
  }

  /** Record a single byte as slot `index`'s payload. Does not set `num`. */
  setPayloadByte(index: number, byte: number) {
    this.reservePayload(1)
    this.payloadBytes[this.payloadLength++] = byte
  }

  /**
   * Release the capacity decoding over-allocated, and index the payloads.
   *
   * The checkpoints are built here, in one pass, rather than maintained as
   * payloads are appended: a slice decodes once and the columns are complete
   * only when it finishes, so this is where every slot's code and `num` are
   * final. Reading an arena that has not been trimmed still works — see
   * {@link indexedLength} — it just builds the index on the first read.
   */
  trim() {
    if (this.length < this.codes.length) {
      const n = this.length
      this.codes = this.codes.slice(0, n)
      this.pos = this.pos.slice(0, n)
      this.refPos = this.refPos.slice(0, n)
      this.num = this.num.slice(0, n)
      this.refCodes = this.refCodes.slice(0, n)
      this.subCodes = this.subCodes.slice(0, n)
    }
    if (this.payloadLength < this.payloadBytes.length) {
      this.payloadBytes = this.payloadBytes.slice(0, this.payloadLength)
    }
    this.indexPayloads()
  }

  /** Fill {@link payloadChunks} from the columns as they stand. */
  private indexPayloads() {
    const { codes, num, length } = this
    this.indexedLength = length
    const chunks = new Int32Array(chunksFor(length))
    let offset = 0
    for (let i = 0; i < length; i++) {
      if ((i & (PAYLOAD_CHUNK_SLOTS - 1)) === 0) {
        chunks[i >> PAYLOAD_CHUNK_SHIFT] = offset
      }
      const payload = RF_PAYLOAD[codes[i]!]!
      if (payload === PAYLOAD_NUM) {
        offset += num[i]!
      } else if (payload === PAYLOAD_ONE_BYTE) {
        offset += 1
      }
    }
    this.payloadChunks = chunks
  }

  /**
   * Where slot `index`'s payload starts in {@link payloadBytes}.
   *
   * Walks forward from the nearest checkpoint, so at most
   * {@link PAYLOAD_CHUNK_SLOTS} − 1 slots. Only the four accessors below need
   * it; a caller walking a whole record in order is better off carrying the
   * running offset itself, as `decodeReadSequenceBytes` does.
   */
  payloadOffsetAt(index: number) {
    if (this.indexedLength !== this.length) {
      this.indexPayloads()
    }
    let offset = this.payloadChunks[index >> PAYLOAD_CHUNK_SHIFT]!
    const { codes, num } = this
    for (let i = index & ~(PAYLOAD_CHUNK_SLOTS - 1); i < index; i++) {
      const payload = RF_PAYLOAD[codes[i]!]!
      if (payload === PAYLOAD_NUM) {
        offset += num[i]!
      } else if (payload === PAYLOAD_ONE_BYTE) {
        offset += 1
      }
    }
    return offset
  }

  /**
   * The bytes slot `index` contributes to {@link payloadBytes} — 0 for a
   * feature that carries none. For walking a record while tracking the offset.
   */
  payloadLengthAt(index: number) {
    const payload = RF_PAYLOAD[this.codes[index]!]!
    if (payload === PAYLOAD_NUM) {
      return this.num[index]!
    }
    return payload === PAYLOAD_ONE_BYTE ? 1 : 0
  }

  /**
   * The raw bytes of slot `index`'s payload, as a view into `payloadBytes`.
   *
   * Only for the codes whose `num` is a payload length — I/S/b/i/q. `num` means
   * something else for every other code, so this would size the view by the
   * quality score of a B or the data value of a D. Use {@link payloadByteAt}
   * for B, the only other code that carries bytes.
   */
  payloadBytesAt(index: number) {
    const offset = this.payloadOffsetAt(index)
    return this.payloadBytes.subarray(offset, offset + this.num[index]!)
  }

  /**
   * The single payload byte of slot `index` — the read base of a B feature.
   *
   * Deliberately not `payloadBytesAt(index)[0]`: `num` is B's *quality score*,
   * so that sized the view by the quality and handed back an empty one whenever
   * the quality was 0, which then read as a NUL instead of the base.
   */
  payloadByteAt(index: number) {
    return this.payloadBytes[this.payloadOffsetAt(index)]!
  }

  /** Slot `index`'s payload decoded as a string — the I/S/b/i `data` value. */
  payloadStringAt(index: number) {
    return decodeUtf8(this.payloadBytesAt(index))
  }

  /**
   * Rebuild slot `index` as the array-of-structs `ReadFeature` this library
   * used to hand out. Allocates; the columns are the cheap path.
   */
  readFeatureAt(index: number): ReadFeature {
    const code = this.codes[index]!
    const pos = this.pos[index]!
    const refPos = this.refPos[index]!
    if (code === RF_SUBST) {
      const feature: ReadFeature = {
        code: 'X',
        pos,
        refPos,
        data: this.num[index]!,
      }
      // assigned only when known, so that a feature the reference has not been
      // applied to serialises without the keys, as it did when they were added
      // by mutation
      const refCode = this.refCodes[index]!
      if (refCode) {
        feature.ref = String.fromCharCode(refCode)
      }
      const subCode = this.subCodes[index]!
      if (subCode) {
        feature.sub = String.fromCharCode(subCode)
      }
      return feature
    }
    if (code === RF_BASE_QUAL) {
      return {
        code: 'B',
        pos,
        refPos,
        data: [
          String.fromCharCode(this.payloadByteAt(index)),
          this.num[index]!,
        ],
      }
    }
    if (code === RF_QUALS) {
      return {
        code: 'q',
        pos,
        refPos,
        data: Array.from(this.payloadBytesAt(index)),
      }
    }
    if (
      code === RF_INSERTION ||
      code === RF_SOFT_CLIP ||
      code === RF_BASES ||
      code === RF_INSERT_BASE
    ) {
      return {
        code: String.fromCharCode(code) as 'I' | 'S' | 'b' | 'i',
        pos,
        refPos,
        data: this.payloadStringAt(index),
      }
    }
    return {
      code: String.fromCharCode(code) as 'D' | 'N' | 'H' | 'P' | 'Q',
      pos,
      refPos,
      data: this.num[index]!,
    }
  }

  /** Rebuild slots `[start, start + count)` as an array of `ReadFeature`. */
  materialize(start: number, count: number) {
    const out: ReadFeature[] = new Array(count)
    for (let i = 0; i < count; i++) {
      out[i] = this.readFeatureAt(start + i)
    }
    return out
  }
}

const encoder = new TextEncoder()

/**
 * Build a single-record arena from plain `ReadFeature` objects. For tests and
 * for callers that synthesise records rather than decoding them; the decoder
 * fills an arena directly.
 */
export function arenaFromReadFeatures(features: ReadFeature[]) {
  const arena = new ReadFeatureArena(Math.max(features.length, 1))
  arena.length = features.length
  for (let i = 0; i < features.length; i++) {
    const feature = features[i]!
    arena.codes[i] = feature.code.charCodeAt(0)
    arena.pos[i] = feature.pos
    arena.refPos[i] = feature.refPos
    // switched on feature.code rather than a destructured copy so that each
    // clause narrows `feature` itself, and with it the type of `feature.data`
    switch (feature.code) {
      case 'X': {
        arena.num[i] = feature.data
        if (feature.ref) {
          arena.refCodes[i] = feature.ref.charCodeAt(0)
        }
        if (feature.sub) {
          arena.subCodes[i] = feature.sub.charCodeAt(0)
        }
        break
      }
      case 'B': {
        arena.setPayloadByte(i, feature.data[0].charCodeAt(0))
        arena.num[i] = feature.data[1]
        break
      }
      case 'q': {
        arena.setPayload(i, new Uint8Array(feature.data))
        arena.num[i] = feature.data.length
        break
      }
      case 'I':
      case 'S':
      case 'b':
      case 'i': {
        const bytes = encoder.encode(feature.data)
        arena.setPayload(i, bytes)
        arena.num[i] = bytes.length
        break
      }
      default: {
        // D, N, H, P, Q: the payload is the numeric data value
        arena.num[i] = feature.data
      }
    }
  }
  // the payload checkpoints are built here, so a synthesised arena is readable
  // on the same terms as a decoded one
  arena.trim()
  return arena
}
