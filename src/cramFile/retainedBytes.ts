/**
 * Estimates for the parts of a decoded slice that are not typed arrays, from
 * the per-object costs in docs/memory.md: a 25-character string retains 56 B on
 * this V8, and an array slot is a pointer.
 */
export const POINTER_BYTES = 8
export const STRING_OVERHEAD_BYTES = 32
export const ARRAY_OVERHEAD_BYTES = 32

export function stringArrayBytes(strings: (string | undefined)[]) {
  let bytes = strings.length * POINTER_BYTES
  for (const s of strings) {
    if (s !== undefined) {
      bytes += STRING_OVERHEAD_BYTES + s.length
    }
  }
  return bytes
}
