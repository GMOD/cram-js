import { inflate } from 'pako'

export function unzip(input: Buffer) {
  return Buffer.from(inflate(input))
}
