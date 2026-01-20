/**
 * Synchronous WASM codec interface for use in the decoding pipeline.
 *
 * The WASM module is initialized once (async), then provides synchronous
 * decode methods that can be used in the hot path without async overhead.
 */

import createHtsCodecsModule from '../../wasm/htscodecs.js'

type HtsCodecsModule = Awaited<ReturnType<typeof createHtsCodecsModule>>

let moduleInstance: HtsCodecsModule | null = null
let initPromise: Promise<boolean> | null = null

/**
 * Initialize the WASM module. Call this once before decoding.
 * Returns true if WASM codecs are available, false otherwise.
 */
export async function initWasmCodecs(): Promise<boolean> {
  if (moduleInstance) {
    return true
  }

  if (!initPromise) {
    initPromise = createHtsCodecsModule()
      .then(m => {
        moduleInstance = m
        // Check if our custom codec functions exist
        const mod = m as any
        return typeof mod._decode_gamma_bulk === 'function'
      })
      .catch(() => false)
  }

  return initPromise
}

/**
 * Check if WASM codecs are initialized and available
 */
export function isWasmReady(): boolean {
  if (!moduleInstance) {
    return false
  }
  const mod = moduleInstance as any
  return typeof mod._decode_gamma_bulk === 'function'
}

/**
 * Get the raw WASM module (for advanced use)
 */
export function getWasmModule(): HtsCodecsModule | null {
  return moduleInstance
}

// Cursor interface matching the codec cursor structure
export interface WasmCursor {
  bytePosition: number
  bitPosition: number
}

/**
 * Decode multiple gamma-encoded values using WASM.
 * Must call initWasmCodecs() first.
 *
 * @returns Int32Array of decoded values, or null if WASM not available
 */
export function wasmDecodeGammaBulk(
  data: Uint8Array,
  cursor: WasmCursor,
  offset: number,
  count: number,
): Int32Array | null {
  if (!moduleInstance) {
    return null
  }

  const module = moduleInstance as any
  if (typeof module._decode_gamma_bulk !== 'function') {
    return null
  }

  // Allocate WASM memory
  const dataPtr = module._malloc(data.length)
  const bytePosPtr = module._malloc(4)
  const bitPosPtr = module._malloc(1)
  const outputPtr = module._malloc(count * 4)

  try {
    // Copy data to WASM
    module.HEAPU8.set(data, dataPtr)
    module.setValue(bytePosPtr, cursor.bytePosition, 'i32')
    module.setValue(bitPosPtr, cursor.bitPosition, 'i8')

    // Call WASM function
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
      return null // Decoding failed
    }

    // Read updated cursor position
    cursor.bytePosition = module.getValue(bytePosPtr, 'i32')
    cursor.bitPosition = module.getValue(bitPosPtr, 'i8')

    // Copy output
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
 * Decode multiple beta-encoded values using WASM.
 */
export function wasmDecodeBetaBulk(
  data: Uint8Array,
  cursor: WasmCursor,
  numBits: number,
  offset: number,
  count: number,
): Int32Array | null {
  if (!moduleInstance) {
    return null
  }

  const module = moduleInstance as any
  if (typeof module._decode_beta_bulk !== 'function') {
    return null
  }

  const dataPtr = module._malloc(data.length)
  const bytePosPtr = module._malloc(4)
  const bitPosPtr = module._malloc(1)
  const outputPtr = module._malloc(count * 4)

  try {
    module.HEAPU8.set(data, dataPtr)
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
      return null
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
 * Decode multiple subexp-encoded values using WASM.
 */
export function wasmDecodeSubexpBulk(
  data: Uint8Array,
  cursor: WasmCursor,
  K: number,
  offset: number,
  count: number,
): Int32Array | null {
  if (!moduleInstance) {
    return null
  }

  const module = moduleInstance as any
  if (typeof module._decode_subexp_bulk !== 'function') {
    return null
  }

  const dataPtr = module._malloc(data.length)
  const bytePosPtr = module._malloc(4)
  const bitPosPtr = module._malloc(1)
  const outputPtr = module._malloc(count * 4)

  try {
    module.HEAPU8.set(data, dataPtr)
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
      return null
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
