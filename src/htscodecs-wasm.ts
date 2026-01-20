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

export async function zlib_uncompress(input: Uint8Array) {
  if (input.length === 0) {
    return new Uint8Array(0)
  }

  const module = await getModule()

  const inPtr = copyToWasm(module, input)
  const outSizePtr = module._malloc(4)

  try {
    const outPtr = module._zlib_uncompress(inPtr, input.length, outSizePtr)
    if (outPtr === 0) {
      throw new Error('zlib_uncompress failed')
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

export async function bz2_uncompress(input: Uint8Array, expectedSize: number) {
  if (input.length === 0) {
    return new Uint8Array(0)
  }

  const module = await getModule()

  const inPtr = copyToWasm(module, input)
  const outSizePtr = module._malloc(4)

  try {
    const outPtr = module._bz2_uncompress(
      inPtr,
      input.length,
      expectedSize,
      outSizePtr,
    )
    if (outPtr === 0) {
      throw new Error('bz2_uncompress failed')
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

export async function tok3_uncompress(input: Uint8Array) {
  const module = await getModule()

  const inPtr = copyToWasm(module, input)
  const outSizePtr = module._malloc(4)

  try {
    const outPtr = module._tok3_decode_names(inPtr, input.length, outSizePtr)
    if (outPtr === 0) {
      throw new Error('tok3_decode_names failed')
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

// =============================================================================
// CRAM Core Block Codecs (WASM implementations)
// =============================================================================

export interface CramCursor {
  bytePosition: number
  bitPosition: number
}

/**
 * WASM-based gamma decoder for bulk decoding multiple values.
 * More efficient than JS implementation for large counts.
 *
 * @param data - Core data block content
 * @param cursor - Current cursor position (will be updated)
 * @param offset - Offset to subtract from decoded values
 * @param count - Number of values to decode
 * @returns Int32Array of decoded values
 */
export async function wasm_decode_gamma_bulk(
  data: Uint8Array,
  cursor: CramCursor,
  offset: number,
  count: number,
): Promise<Int32Array> {
  const module = await getModule() as any // Cast to any until WASM module is rebuilt

  const dataPtr = copyToWasm(module, data)
  const bytePosPtr = module._malloc(4)
  const bitPosPtr = module._malloc(1)
  const outputPtr = module._malloc(count * 4)

  try {
    // Write cursor position to WASM memory
    module.setValue(bytePosPtr, cursor.bytePosition, 'i32')
    module.setValue(bitPosPtr, cursor.bitPosition, 'i8')

    const decoded = module._decode_gamma_bulk(
      dataPtr,
      data.length,
      bytePosPtr,
      bitPosPtr,
      offset,
      outputPtr,
      count,
    )

    if (decoded !== count) {
      throw new Error(`decode_gamma_bulk failed: decoded ${decoded} of ${count}`)
    }

    // Read updated cursor position
    cursor.bytePosition = module.getValue(bytePosPtr, 'i32')
    cursor.bitPosition = module.getValue(bitPosPtr, 'i8')

    // Copy output array
    const result = new Int32Array(count)
    for (let i = 0; i < count; i++) {
      result[i] = module.getValue(outputPtr + i * 4, 'i32')
    }
    return result
  } finally {
    module._free(dataPtr)
    module._free(bytePosPtr)
    module._free(bitPosPtr)
    module._free(outputPtr)
  }
}

/**
 * WASM-based beta decoder for bulk decoding multiple values.
 */
export async function wasm_decode_beta_bulk(
  data: Uint8Array,
  cursor: CramCursor,
  numBits: number,
  offset: number,
  count: number,
): Promise<Int32Array> {
  const module = await getModule() as any // Cast to any until WASM module is rebuilt

  const dataPtr = copyToWasm(module, data)
  const bytePosPtr = module._malloc(4)
  const bitPosPtr = module._malloc(1)
  const outputPtr = module._malloc(count * 4)

  try {
    module.setValue(bytePosPtr, cursor.bytePosition, 'i32')
    module.setValue(bitPosPtr, cursor.bitPosition, 'i8')

    const decoded = module._decode_beta_bulk(
      dataPtr,
      data.length,
      bytePosPtr,
      bitPosPtr,
      numBits,
      offset,
      outputPtr,
      count,
    )

    if (decoded !== count) {
      throw new Error(`decode_beta_bulk failed: decoded ${decoded} of ${count}`)
    }

    cursor.bytePosition = module.getValue(bytePosPtr, 'i32')
    cursor.bitPosition = module.getValue(bitPosPtr, 'i8')

    const result = new Int32Array(count)
    for (let i = 0; i < count; i++) {
      result[i] = module.getValue(outputPtr + i * 4, 'i32')
    }
    return result
  } finally {
    module._free(dataPtr)
    module._free(bytePosPtr)
    module._free(bitPosPtr)
    module._free(outputPtr)
  }
}

/**
 * WASM-based subexp decoder for bulk decoding multiple values.
 */
export async function wasm_decode_subexp_bulk(
  data: Uint8Array,
  cursor: CramCursor,
  K: number,
  offset: number,
  count: number,
): Promise<Int32Array> {
  const module = await getModule() as any // Cast to any until WASM module is rebuilt

  const dataPtr = copyToWasm(module, data)
  const bytePosPtr = module._malloc(4)
  const bitPosPtr = module._malloc(1)
  const outputPtr = module._malloc(count * 4)

  try {
    module.setValue(bytePosPtr, cursor.bytePosition, 'i32')
    module.setValue(bitPosPtr, cursor.bitPosition, 'i8')

    const decoded = module._decode_subexp_bulk(
      dataPtr,
      data.length,
      bytePosPtr,
      bitPosPtr,
      K,
      offset,
      outputPtr,
      count,
    )

    if (decoded !== count) {
      throw new Error(`decode_subexp_bulk failed: decoded ${decoded} of ${count}`)
    }

    cursor.bytePosition = module.getValue(bytePosPtr, 'i32')
    cursor.bitPosition = module.getValue(bitPosPtr, 'i8')

    const result = new Int32Array(count)
    for (let i = 0; i < count; i++) {
      result[i] = module.getValue(outputPtr + i * 4, 'i32')
    }
    return result
  } finally {
    module._free(dataPtr)
    module._free(bytePosPtr)
    module._free(bitPosPtr)
    module._free(outputPtr)
  }
}

/**
 * Check if WASM CRAM codecs are available
 */
export async function wasmCodecsAvailable(): Promise<boolean> {
  try {
    const module = await getModule() as any
    return typeof module._decode_gamma_bulk === 'function'
  } catch {
    return false
  }
}
