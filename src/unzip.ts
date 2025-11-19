import { inflate } from 'pako-esm2'

// Use inflate directly instead of unzip for better performance
// inflate is the low-level decompression function without wrapper overhead
export function unzip(input: Uint8Array): Uint8Array {
  return inflate(input, undefined)
}
