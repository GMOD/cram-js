import * as pkg from 'pako'
const { inflate } = pkg

export function unzip(input: Uint8Array) {
  return inflate(input)
}
