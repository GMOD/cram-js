// Fallback JS implementation of tok3 for when WASM fails
// This uses the original JavaScript reference implementation
import * as tok3 from './tok3.ts'

export function tok3_uncompress_js(inputBuffer: Uint8Array) {
  // @ts-expect-error tok3.decode has loose typing
  const out = tok3.decode(inputBuffer, 0, '\0')
  return Uint8Array.from(Array.from(out).map(letter => letter.charCodeAt(0)))
}
