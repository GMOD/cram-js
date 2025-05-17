import { inflate } from '@progress/pako-esm'

export function unzip(input: Uint8Array) {
  return inflate(input)
}
