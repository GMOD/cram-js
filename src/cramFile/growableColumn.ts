/**
 * Geometric growth for the columnar stores a slice decodes into.
 *
 * {@link ReadFeatureArena}, {@link TagColumn} and the quality column all fill
 * typed arrays whose final size is unknown until the slice is decoded, and all
 * three had written this out themselves — two of them as a `growUint8` /
 * `growInt32` / `nextCapacity` trio, the third as the same arithmetic inline.
 *
 * Doubling, and trimming afterwards, is the shape all three want: a slice
 * decodes once and is then held in the record cache, so the copies happen
 * during the decode and the slack is handed back at the end of it. See each
 * column's `trim`.
 */

/** the typed arrays the columns are made of */
type Column = Uint8Array | Uint16Array | Int32Array

/**
 * A copy of `column` holding `capacity` elements, of the same type.
 *
 * Constructed through `column.constructor` rather than by naming the type, so
 * one function serves all three — including the `ArrayBuffer` variance each
 * column declares, which the generic carries through where a union return type
 * would flatten it.
 */
export function grow<T extends Column>(column: T, capacity: number): T {
  const out = new (column.constructor as new (length: number) => T)(capacity)
  out.set(column)
  return out
}

/**
 * The next doubling of `current` that holds `needed` elements.
 *
 * `Math.max(current, 1)` because doubling zero never gets anywhere: a column
 * constructed empty — as `sliceTransfer` does when rebuilding one whose arrays
 * arrive from a worker — would otherwise spin here forever the first time
 * anything was appended to it.
 */
export function nextCapacity(current: number, needed: number) {
  let capacity = Math.max(current, 1) * 2
  while (capacity < needed) {
    capacity *= 2
  }
  return capacity
}
