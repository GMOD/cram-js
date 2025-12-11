import { inflate } from './wasm/inflate-wasm-inlined.js'

export async function unzip(input: Uint8Array): Promise<Uint8Array> {
  return inflate(input)
}
