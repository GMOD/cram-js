import { inflate } from 'pako'
import { Buffer } from 'buffer'

export function unzip(input: Buffer) {
  return Buffer.from(inflate(input))
}
