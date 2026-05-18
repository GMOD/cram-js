import createHtsCodecsModule from './wasm/htscodecs.js'

type HtsCodecsModule = Awaited<ReturnType<typeof createHtsCodecsModule>>

let moduleInstance: HtsCodecsModule | null = null
let modulePromise: Promise<HtsCodecsModule> | null = null

async function getModule() {
  if (moduleInstance) {
    return moduleInstance
  }
  if (!modulePromise) {
    modulePromise = createHtsCodecsModule().then(m => {
      moduleInstance = m
      return m
    })
  }
  return modulePromise
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
  call: (
    module: HtsCodecsModule,
    inPtr: number,
    outSizePtr: number,
  ) => number,
  emptyOk = false,
): Promise<Uint8Array> {
  if (emptyOk && input.length === 0) {
    return new Uint8Array(0)
  }
  const module = await getModule()
  const inPtr = copyToWasm(module, input)
  const outSizePtr = module._malloc(4)
  try {
    const outPtr = call(module, inPtr, outSizePtr)
    if (outPtr === 0) {
      throw new Error(`${fnName} failed`)
    }
    const outSize = module.getValue(outSizePtr, 'i32')
    const result = copyFromWasm(module, outPtr, outSize)
    module._free(outPtr)
    return result
  } finally {
    module._free(inPtr)
    module._free(outSizePtr)
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

export function zlib_uncompress(input: Uint8Array) {
  return decompress(
    input,
    'zlib_uncompress',
    (m, i, o) => m._zlib_uncompress(i, input.length, o),
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
