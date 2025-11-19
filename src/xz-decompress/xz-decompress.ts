/* !
 * This is adapted from the xz-decompress NPM package.
 * https://github.com/httptoolkit/xz-decompress/ License MIT
 *
 * That codebase in turn had these citations
 * Based on xzwasm (c) Steve Sanderson. License: MIT - https://github.com/SteveSanderson/xzwasm
 * Contains xz-embedded by Lasse Collin and Igor Pavlov. License: Public domain - https://tukaani.org/xz/embedded.html
 * and walloc (c) 2020 Igalia, S.L. License: MIT - https://github.com/wingo/walloc
 */

import { xzdecompressWasm as wasmBase64 } from './wasm.ts'

const XZ_OK = 0
const XZ_STREAM_END = 1

interface WasmExports {
  memory: WebAssembly.Memory
  create_context(): number
  destroy_context(ptr: number): void
  supply_input(ptr: number, length: number): void
  get_next_output(ptr: number): number
}

class XzContext {
  exports: WasmExports
  memory: WebAssembly.Memory
  ptr: number
  bufSize: number
  inStart: number
  outStart: number
  mem8?: Uint8Array
  mem32?: Uint32Array

  constructor(moduleInstance: WebAssembly.Instance) {
    this.exports = moduleInstance.exports as unknown as WasmExports
    this.memory = this.exports.memory
    this.ptr = this.exports.create_context()
    this._refresh()
    this.bufSize = this.mem32![0]!
    this.inStart = this.mem32![1]! - this.ptr
    this.outStart = this.mem32![4]! - this.ptr
  }

  supplyInput(sourceDataUint8Array: Uint8Array) {
    this._refresh()
    const inBuffer = this.mem8!.subarray(
      this.inStart,
      this.inStart + this.bufSize,
    )
    inBuffer.set(sourceDataUint8Array, 0)
    this.exports.supply_input(this.ptr, sourceDataUint8Array.byteLength)
  }

  getNextOutput() {
    const result = this.exports.get_next_output(this.ptr)
    this._refresh()
    if (result !== XZ_OK && result !== XZ_STREAM_END) {
      throw new Error(`get_next_output failed with error code ${result}`)
    }
    const outChunk = this.mem8!.slice(
      this.outStart,
      this.outStart + /* outPos */ this.mem32![5]!,
    )
    return { outChunk, finished: result === XZ_STREAM_END }
  }

  dispose() {
    this.exports.destroy_context(this.ptr)
    this.exports = null as any
  }

  _refresh() {
    const currentBuffer = this.memory.buffer
    if (currentBuffer !== this.mem8?.buffer) {
      this.mem8 = new Uint8Array(currentBuffer, this.ptr)
      this.mem32 = new Uint32Array(currentBuffer, this.ptr)
    }
  }
}

let _moduleInstancePromise: Promise<void> | undefined
let _moduleInstance: WebAssembly.Instance | undefined
const _emptyInput = new Uint8Array(0)

async function _getModuleInstance() {
  const base64Wasm = wasmBase64.replace('data:application/wasm;base64,', '')
  const binaryString = atob(base64Wasm)
  const len = binaryString.length
  const wasmBytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    wasmBytes[i] = binaryString.charCodeAt(i)
  }
  const module = await WebAssembly.instantiate(wasmBytes.buffer, {})
  _moduleInstance = module.instance
}

export async function xzDecompress(input: Uint8Array): Promise<Uint8Array> {
  if (!_moduleInstance) {
    await (_moduleInstancePromise ||
      (_moduleInstancePromise = _getModuleInstance()))
  }

  const context = new XzContext(_moduleInstance!)
  const chunks: Uint8Array[] = []
  let offset = 0
  let eofSignaled = false

  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      // Check if WASM needs more input (inPos === inSize)
      // eslint-disable-next-line @typescript-eslint/no-confusing-non-null-assertion
      if (context.mem32![2]! === context.mem32![3]!) {
        if (offset < input.length) {
          const chunkSize = Math.min(context.bufSize, input.length - offset)
          context.supplyInput(input.subarray(offset, offset + chunkSize))
          offset += chunkSize
        } else if (!eofSignaled) {
          // Signal EOF by supplying empty input once
          context.supplyInput(_emptyInput)
          eofSignaled = true
        } else {
          // Stuck in a loop - WASM needs more input but we're at EOF
          throw new Error('XZ decompression error: unexpected end of input')
        }
      }

      const result = context.getNextOutput()
      if (result.outChunk.length > 0) {
        chunks.push(result.outChunk)
      }
      // Reset output buffer position
      context.mem32![5] = 0

      if (result.finished) {
        break
      }
    }

    if (chunks.length === 1) {
      return chunks[0]!
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const output = new Uint8Array(totalLength)
    let position = 0
    for (const chunk of chunks) {
      output.set(chunk, position)
      position += chunk.length
    }
    return output
  } finally {
    context.dispose()
  }
}
