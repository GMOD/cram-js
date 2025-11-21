import { inflate } from 'pako-esm2'

export function unzip(input: Uint8Array): Uint8Array {
  return inflate(input, undefined)
}
