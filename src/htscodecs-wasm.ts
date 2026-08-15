import { memoizeAsync } from './cramFile/memoize.ts'
import { CramMalformedError } from './errors.ts'
import createHtsCodecsModule from './wasm/htscodecs.js'

type HtsCodecsModule = Awaited<ReturnType<typeof createHtsCodecsModule>>

// memoizeAsync forgets a rejection. A cache that kept one would fail every
// compressed block for the life of the process over a single bad moment.
const getModule = memoizeAsync(() => createHtsCodecsModule())

/**
 * Instantiate the wasm module now rather than on the first block that needs it.
 *
 * For the slice-decode worker pool: compiling and instantiating the module is
 * one-off work of the same order as decoding a small slice, and without this
 * every worker pays it on its first dispatch — so the first batch of a query,
 * which is the one a user is waiting on, would be the slowest. Called during the
 * pool's init handshake, before any slice is sent.
 */
export async function warmupWasm() {
  await getModule()
}

function copyToWasm(module: HtsCodecsModule, data: Uint8Array) {
  const ptr = module._malloc(data.length)
  module.HEAPU8.set(data, ptr)
  return ptr
}

function copyFromWasm(module: HtsCodecsModule, ptr: number, size: number) {
  const result = new Uint8Array(size)
  result.set(module.HEAPU8.subarray(ptr, ptr + size))
  return result
}

// Shared decompress driver: allocates the input buffer + out-size pointer,
// invokes the codec-specific wasm call, copies the result out, frees everything.
// Codec-specific extras (e.g. fqzcomp's lenPtr, bz2's expectedSize) are baked
// into the `call` closure by each wrapper.
async function decompress(
  input: Uint8Array,
  fnName: string,
  call: (module: HtsCodecsModule, inPtr: number, outSizePtr: number) => number,
  emptyOk = false,
): Promise<Uint8Array> {
  if (emptyOk && input.length === 0) {
    return new Uint8Array(0)
  }
  const module = await getModule()
  const inPtr = copyToWasm(module, input)
  const outSizePtr = module._malloc(4)
  let outPtr = 0
  try {
    outPtr = call(module, inPtr, outSizePtr)
    if (outPtr === 0) {
      // A codec that returns NULL is a block that will not decode, which is a
      // statement about the file — the same one `parseBlock` makes fifteen lines
      // later when a decode produces the wrong number of bytes, and it raises a
      // CramMalformedError for it. A bare Error here also arrived from a worker
      // as a nameless Error, indistinguishable from the worker having crashed.
      throw new CramMalformedError(`${fnName} failed`)
    }
    return copyFromWasm(module, outPtr, module.getValue(outSizePtr, 'i32'))
  } finally {
    // outPtr in the finally too: the copy out allocates, so it can throw, and
    // this heap only ever grows — anything not freed is held for the process
    module._free(inPtr)
    module._free(outSizePtr)
    if (outPtr !== 0) {
      module._free(outPtr)
    }
  }
}

// rans_uncompress empty check: C implementation returns NULL for in_size < 9
export function rans_uncompress(input: Uint8Array) {
  return decompress(
    input,
    'rans_uncompress',
    (m, i, o) => m._rans_uncompress(i, input.length, o),
    true,
  )
}

export function r4x16_uncompress(input: Uint8Array) {
  return decompress(input, 'rans_uncompress_4x16', (m, i, o) =>
    m._rans_uncompress_4x16(i, input.length, o),
  )
}

export function arith_uncompress(input: Uint8Array) {
  return decompress(input, 'arith_uncompress', (m, i, o) =>
    m._arith_uncompress(i, input.length, o),
  )
}

export async function fqzcomp_uncompress(input: Uint8Array) {
  const module = await getModule()
  const lenPtr = module._malloc(4)
  try {
    return await decompress(input, 'fqz_decompress', (m, i, o) =>
      m._fqz_decompress(i, input.length, o, lenPtr),
    )
  } finally {
    module._free(lenPtr)
  }
}

// expectedSize lets libdeflate allocate the output buffer exactly once; pass 0
// when the size is not known ahead of time and it grows on demand instead.
export function zlib_uncompress(input: Uint8Array, expectedSize = 0) {
  return decompress(
    input,
    'zlib_uncompress',
    (m, i, o) => m._zlib_uncompress(i, input.length, expectedSize, o),
    true,
  )
}

export function bz2_uncompress(input: Uint8Array, expectedSize: number) {
  return decompress(
    input,
    'bz2_uncompress',
    (m, i, o) => m._bz2_uncompress(i, input.length, expectedSize, o),
    true,
  )
}

export function tok3_uncompress(input: Uint8Array) {
  return decompress(input, 'tok3_decode_names', (m, i, o) =>
    m._tok3_decode_names(i, input.length, o),
  )
}
