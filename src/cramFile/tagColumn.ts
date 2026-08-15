import { grow, nextCapacity } from './growableColumn.ts'

/**
 * How to read a slot's entry in {@link TagColumn.values}.
 *
 * The kind is a property of the tag's *type*, which CRAM fixes per tag id for a
 * whole container, so it could live in a per-key table rather than per slot.
 * It is per slot because that removes an indirection from the middle of
 * {@link TagColumn.getTag}, which is the hot path, at one byte per tag instance
 * against the ~11 tags a minimap2 short read carries.
 */
/** {@link TagColumn.values} holds the number itself */
export const TAG_NUMBER = 0
/** a `A`-type tag: {@link TagColumn.values} holds the character's code */
export const TAG_CHAR = 1
/** {@link TagColumn.values} holds an index into {@link TagColumn.strings} */
export const TAG_STRING = 2
/** {@link TagColumn.values} holds an index into {@link TagColumn.arrays} */
export const TAG_ARRAY = 3
/**
 * {@link TagColumn.values} holds an index into {@link TagColumn.doubles} — a
 * value that does not fit an int32, so either a float (`de`, `dv`) or a `I`-type
 * tag above 2^31-1.
 */
export const TAG_DOUBLE = 4

export type TagValue = string | number | number[] | undefined

const INITIAL_SLOTS = 4096

/**
 * Struct-of-arrays storage for the aux tags of every record in one slice.
 *
 * A record occupies the half-open slot range
 * `[record.tagStart, record.tagStart + record.tagCount)`, the same shape
 * {@link ReadFeatureArena} uses for read features.
 *
 * **What this is for, and what it is not for.** Unlike
 * {@link ReadFeatureArena} and the quality column, whose whole point is memory,
 * this one is roughly *break-even* on memory and was taken for two other
 * reasons — see the numbers at the end. Do not "improve" it on the assumption
 * that it saved heap.
 *
 * The `Record<string, TagValue>` it replaced cost an object plus a property per
 * tag on every record, and tags are dense in a way read features are not:
 * minimap2 output carries **11 tags on every read**, so a 19kb query against
 * 1000x-coverage short reads built 153,677 objects holding 1.69 million values.
 * Three things follow from measuring that corpus:
 *
 * - **Almost everything is numeric.** 81.8% of those values are already numbers,
 *   and folding `A`-type tags in as their character code (see {@link TAG_CHAR})
 *   takes it to **90.9%** — 100% on long reads, where `tp` is the only
 *   non-numeric tag. So {@link values} carries nearly the whole corpus; see
 *   there for why it is `Int32Array` and not the `Float64Array` this started as.
 * - **Genuine strings are few.** What is left is `MC`, `SA`, `XA` — CIGAR and
 *   alignment strings. They stay a `string[]`, which is also the cheapest thing
 *   to hand across a worker boundary: 15 ms for 153,677 strings against 112 ms
 *   to encode the same set into bytes. Deliberately *not* deduplicated — see
 *   `docs/adr/0007-optimizations-measured-and-rejected.md`, where interning cost
 *   10-20% of the decode, because hashing a string means reading every
 *   character of it.
 * - **`B`-array tags are absent from every performance fixture** but present in
 *   the type-coverage ones (`auxf#values`, `ML_test`), so {@link arrays} is a
 *   correctness lane rather than a fast one.
 *
 * The two things it did buy, both measured:
 *
 * - **Tags cross a worker boundary by transfer.** `keyIds`, `kinds` and `values`
 *   are typed arrays, so the 243 ms of structured clone that `tags` cost on that
 *   query becomes 11 ms — and it was the largest single term in the 1011 ms of
 *   cloning a decoded slice, against a 392 ms decode.
 * - **{@link getTag} answers for one tag without building the object**, 3.8-7.8x
 *   faster than going through `tags`.
 *
 * And what it did not: retained heap moved -0.06 MB on SRR396637 and +0.20 MB on
 * SRR396636 (JS heap -1.16 MB against +1.10 MB of array buffers), and decode time
 * did not move outside the noise floor — an A-B-A run put the two A medians
 * further apart than A from B. The memory story only turns positive once
 * consumers stop touching `tags` at all, since the cache it fills then holds the
 * object *and* the columns.
 */
export default class TagColumn {
  /** index into {@link keyNames} — the tag's two-character name */
  keyIds: Uint16Array
  /** one of the `TAG_*` constants, saying how to read {@link values} */
  kinds: Uint8Array
  /**
   * The numeric value, a character code, or an index into a side table.
   *
   * `Int32Array` rather than `Float64Array`, which halves it: the values that do
   * not fit — floats, and `I` tags above 2^31-1 — go to {@link doubles} and are
   * indexed from here. A single Float64 column is the obvious layout and was the
   * first one, but it made the whole change a **memory regression** (+0.57 MB on
   * SRR396637), because the `Record` it replaced holds a small-int property in
   * far less than eight bytes. `de`/`dv` are the only floats minimap2 emits, one
   * per read against eleven tags, so the side table stays small.
   */
  values: Int32Array
  /** values of the `Z`-type tags, in slot order */
  strings: string[] = []
  /** values of the `B`-type tags, in slot order */
  arrays: number[][] = []
  /** values too wide for {@link values}; see there */
  doubles: number[] = []
  /** two-character tag name for each key id */
  keyNames: string[] = []
  private keyIdByName = new Map<string, number>()
  /** number of slots in use */
  length = 0

  constructor(slots = INITIAL_SLOTS) {
    this.keyIds = new Uint16Array(slots)
    this.kinds = new Uint8Array(slots)
    this.values = new Int32Array(slots)
  }

  /**
   * The id for a tag name, assigning one if this is the first time the slice has
   * seen it. Called once per tag id per slice, not per record.
   *
   * Keyed by *name* rather than by CRAM's three-character tag id, so two ids
   * differing only in type collapse to one key — which is what makes the last
   * slot win in {@link getTag} and {@link materialize}, matching the
   * `tags[name] = …` assignment this replaced.
   */
  keyIdFor(name: string) {
    let id = this.keyIdByName.get(name)
    if (id === undefined) {
      id = this.keyNames.length
      this.keyNames.push(name)
      this.keyIdByName.set(name, id)
    }
    return id
  }

  private reserve() {
    if (this.length === this.keyIds.length) {
      const capacity = nextCapacity(this.keyIds.length, this.length + 1)
      this.keyIds = grow(this.keyIds, capacity)
      this.kinds = grow(this.kinds, capacity)
      this.values = grow(this.values, capacity)
    }
  }

  /**
   * Append one tag instance, whose value is a number or a character code.
   *
   * Anything that would not survive the round trip through {@link values} — a
   * float, or a `I` tag past 2^31-1 — is diverted to {@link doubles}. `| 0` is
   * not enough of a test on its own: it agrees for every int32 but also for
   * larger integers whose low 32 bits happen to match, so the range is checked
   * explicitly.
   */
  pushNumber(keyId: number, kind: number, value: number) {
    this.reserve()
    const i = this.length++
    this.keyIds[i] = keyId
    if (
      value >= -2147483648 &&
      value <= 2147483647 &&
      Number.isInteger(value)
    ) {
      this.kinds[i] = kind
      this.values[i] = value
    } else {
      this.kinds[i] = TAG_DOUBLE
      this.values[i] = this.doubles.length
      this.doubles.push(value)
    }
  }

  /** Append one `Z`-type tag instance. */
  pushString(keyId: number, value: string) {
    this.reserve()
    const i = this.length++
    this.keyIds[i] = keyId
    this.kinds[i] = TAG_STRING
    this.values[i] = this.strings.length
    this.strings.push(value)
  }

  /** Append one `B`-type tag instance. */
  pushArray(keyId: number, value: number[]) {
    this.reserve()
    const i = this.length++
    this.keyIds[i] = keyId
    this.kinds[i] = TAG_ARRAY
    this.values[i] = this.arrays.length
    this.arrays.push(value)
  }

  /** The value in slot `index`, as the public tag API hands it out. */
  valueAt(index: number): TagValue {
    const value = this.values[index]!
    switch (this.kinds[index]) {
      case TAG_NUMBER:
        return value
      case TAG_CHAR:
        return String.fromCharCode(value)
      case TAG_STRING:
        return this.strings[value]
      case TAG_ARRAY:
        return this.arrays[value]
      default:
        return this.doubles[value]
    }
  }

  /**
   * One record's value for `name`, without materialising the rest of its tags.
   *
   * A linear scan of the record's own slots, which is 11 of them on minimap2
   * output — cheaper than the object it avoids building, and the reason this
   * exists: jbrowse's `colorBy.tag`, `sortTag` and `hasSA` paths ask for one tag
   * per read, and its BAM adapter already prefers a `getTag` for exactly this
   * (see `extractFeatureTagValue.ts`) while CRAM had only the full decode.
   *
   * Scans forward keeping the last match, so a name carried under two tag ids
   * resolves the way the `tags` object's overwrite did.
   */
  getTag(start: number, count: number, name: string): TagValue {
    const keyId = this.keyIdByName.get(name)
    if (keyId === undefined) {
      return undefined
    }
    const keyIds = this.keyIds
    let found = -1
    for (let i = start; i < start + count; i++) {
      if (keyIds[i] === keyId) {
        found = i
      }
    }
    return found < 0 ? undefined : this.valueAt(found)
  }

  /** One record's tags as the `Record<string, TagValue>` this API hands out. */
  materialize(start: number, count: number) {
    const tags: Record<string, TagValue> = {}
    const { keyIds, keyNames } = this
    for (let i = start; i < start + count; i++) {
      tags[keyNames[keyIds[i]!]!] = this.valueAt(i)
    }
    return tags
  }

  /** Release the capacity decoding over-allocated; the column outlives it. */
  trim() {
    if (this.length < this.keyIds.length) {
      const n = this.length
      this.keyIds = this.keyIds.slice(0, n)
      this.kinds = this.kinds.slice(0, n)
      this.values = this.values.slice(0, n)
    }
  }
}
