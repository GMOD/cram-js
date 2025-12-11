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

export async function rans_uncompress(input: Uint8Array) {
  // Handle empty input - C implementation returns NULL for in_size < 9
  if (input.length === 0) {
    return new Uint8Array(0)
  }

  const module = await getModule()

  const inPtr = copyToWasm(module, input)
  const outSizePtr = module._malloc(4)

  try {
    const outPtr = module._rans_uncompress(inPtr, input.length, outSizePtr)
    if (outPtr === 0) {
      throw new Error('rans_uncompress failed')
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

export async function r4x16_uncompress(input: Uint8Array) {
  const module = await getModule()

  const inPtr = copyToWasm(module, input)
  const outSizePtr = module._malloc(4)

  try {
    const outPtr = module._rans_uncompress_4x16(inPtr, input.length, outSizePtr)
    if (outPtr === 0) {
      throw new Error('rans_uncompress_4x16 failed')
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

export async function arith_uncompress(input: Uint8Array) {
  const module = await getModule()

  const inPtr = copyToWasm(module, input)
  const outSizePtr = module._malloc(4)

  try {
    const outPtr = module._arith_uncompress(inPtr, input.length, outSizePtr)
    if (outPtr === 0) {
      throw new Error('arith_uncompress failed')
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

export async function fqzcomp_uncompress(input: Uint8Array) {
  const module = await getModule()

  const inPtr = copyToWasm(module, input)
  const outSizePtr = module._malloc(4)
  const lenPtr = module._malloc(4)

  try {
    const outPtr = module._fqz_decompress(
      inPtr,
      input.length,
      outSizePtr,
      lenPtr,
    )
    if (outPtr === 0) {
      throw new Error('fqz_decompress failed')
    }

    const outSize = module.getValue(outSizePtr, 'i32')
    const result = copyFromWasm(module, outPtr, outSize)
    module._free(outPtr)
    return result
  } finally {
    module._free(inPtr)
    module._free(outSizePtr)
    module._free(lenPtr)
  }
}

export async function tok3_uncompress(input: Uint8Array) {
  const module = await getModule()

  const inPtr = copyToWasm(module, input)
  const outSizePtr = module._malloc(4)

  try {
    const outPtr = module._tok3_decode_names(inPtr, input.length, outSizePtr)
    if (outPtr === 0) {
      // Fallback to JS implementation if WASM fails
      const { tok3_uncompress_js } = await import('./htscodecs/tok3-fallback.ts')
      return tok3_uncompress_js(input)
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
