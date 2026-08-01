import { zlib_uncompress } from './htscodecs-wasm.ts'

export async function unzip(
  input: Uint8Array,
  expectedSize = 0,
): Promise<Uint8Array> {
  return zlib_uncompress(input, expectedSize)
}
