import { zlib_uncompress } from './htscodecs-wasm.ts'

export async function unzip(input: Uint8Array): Promise<Uint8Array> {
  return zlib_uncompress(input)
}
