import { inflate } from 'pako'

export function unzip(input: Uint8Array) {
  return inflate(input)
}
