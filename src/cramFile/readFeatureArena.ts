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

/**
 * Struct-of-arrays storage for the read features of every record in one slice.
 *
 * Read features are the dominant term in decoded-record memory on long-read
 * data — a 37-record ONT slice decodes 213k of them — and an
 * `{code, pos, refPos, data}` object costs 64 bytes before
 * `addReferenceSequence` widens the substitutions to 81. Here each feature is
 * 19 bytes of typed-array columns and the fixed per-array overhead is amortised
 * across the whole slice.
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
  /** offset into {@link payloadBytes} for I/S/b/i/q/B; meaningless otherwise */
  payloadOffsets: Int32Array
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
    this.payloadOffsets = new Int32Array(slots)
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
      this.payloadOffsets = grow(this.payloadOffsets, capacity)
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

  /** Record `bytes` as slot `index`'s byte payload. Does not set `num`. */
  setPayload(index: number, bytes: Uint8Array) {
    this.reservePayload(bytes.length)
    this.payloadOffsets[index] = this.payloadLength
    this.payloadBytes.set(bytes, this.payloadLength)
    this.payloadLength += bytes.length
  }

  /** Record a single byte as slot `index`'s payload. Does not set `num`. */
  setPayloadByte(index: number, byte: number) {
    this.reservePayload(1)
    this.payloadOffsets[index] = this.payloadLength
    this.payloadBytes[this.payloadLength++] = byte
  }

  /** Release the capacity decoding over-allocated; the arena outlives it. */
  trim() {
    if (this.length < this.codes.length) {
      const n = this.length
      this.codes = this.codes.slice(0, n)
      this.pos = this.pos.slice(0, n)
      this.refPos = this.refPos.slice(0, n)
      this.num = this.num.slice(0, n)
      this.payloadOffsets = this.payloadOffsets.slice(0, n)
      this.refCodes = this.refCodes.slice(0, n)
      this.subCodes = this.subCodes.slice(0, n)
    }
    if (this.payloadLength < this.payloadBytes.length) {
      this.payloadBytes = this.payloadBytes.slice(0, this.payloadLength)
    }
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
    const offset = this.payloadOffsets[index]!
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
    return this.payloadBytes[this.payloadOffsets[index]!]!
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
  return arena
}
