/*!
 * This is a copy of the compiled output of the xz-decompress NPM package.
 * https://github.com/httptoolkit/xz-decompress/ License MIT
 *
 * That codebase in turn had these citations
 * Based on xzwasm (c) Steve Sanderson. License: MIT - https://github.com/SteveSanderson/xzwasm
 * Contains xz-embedded by Lasse Collin and Igor Pavlov. License: Public domain - https://tukaani.org/xz/embedded.html
 * and walloc (c) 2020 Igalia, S.L. License: MIT - https://github.com/wingo/walloc
 */

import { ReadableStream as NodeReadableStream } from 'stream/web'
import { xzdecompressWasm as wasmBase64 } from './wasm'

const ReadableStream = globalThis.ReadableStream || NodeReadableStream

const XZ_OK = 0
const XZ_STREAM_END = 1

interface WasmExports {
  memory: WebAssembly.Memory
  create_context(): number
  destroy_context(ptr: number): void
  supply_input(ptr: number, length: number): void
  get_next_output(ptr: number): number
}

interface XzOutputResult {
  outChunk: Uint8Array
  finished: boolean
}

class XzContext {
  exports: WasmExports
  memory: WebAssembly.Memory
  ptr: number
  bufSize: number
  inStart: number
  inEnd: number
  outStart: number
  mem8?: Uint8Array
  mem32?: Uint32Array
  outPos?: number

  constructor(moduleInstance: WebAssembly.Instance) {
    this.exports = moduleInstance.exports as unknown as WasmExports
    this.memory = this.exports.memory
    this.ptr = this.exports.create_context()
    this._refresh()
    this.bufSize = this.mem32![0]!
    this.inStart = this.mem32![1]! - this.ptr
    this.inEnd = this.inStart + this.bufSize
    this.outStart = this.mem32![4]! - this.ptr
  }

  supplyInput(sourceDataUint8Array: Uint8Array) {
    this._refresh()
    const inBuffer = this.mem8!.subarray(this.inStart, this.inEnd)
    inBuffer.set(sourceDataUint8Array, 0)
    this.exports.supply_input(this.ptr, sourceDataUint8Array.byteLength)
  }

  getNextOutput(): XzOutputResult {
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

  needsMoreInput() {
    return /* inPos */ this.mem32![2]! === /* inSize */ this.mem32![3]!
  }

  outputBufferIsFull() {
    return /* outPos */ this.mem32![5]! === this.bufSize
  }

  resetOutputBuffer() {
    this.outPos = this.mem32![5]! = 0
  }

  dispose() {
    this.exports.destroy_context(this.ptr)
    this.exports = null as any
  }

  _refresh() {
    const currentBuffer = this.memory.buffer
    if (!this.mem8 || currentBuffer !== this.mem8.buffer) {
      this.mem8 = new Uint8Array(currentBuffer, this.ptr)
      this.mem32 = new Uint32Array(currentBuffer, this.ptr)
    }
  }
}

class ContextMutex {
  locked: boolean
  waitQueue: Array<() => void>

  constructor() {
    this.locked = false
    this.waitQueue = []
  }

  async acquire() {
    if (!this.locked) {
      this.locked = true
      return
    }

    return new Promise<void>(resolve => {
      this.waitQueue.push(resolve)
    })
  }

  release() {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!
      next()
    } else {
      this.locked = false
    }
  }
}

export class XzReadableStream extends ReadableStream<Uint8Array> {
  static _moduleInstancePromise: Promise<void> | undefined
  static _moduleInstance: WebAssembly.Instance | undefined
  static _contextMutex = new ContextMutex()

  static async _getModuleInstance() {
    const base64Wasm = wasmBase64.replace('data:application/wasm;base64,', '')
    const binaryString = atob(base64Wasm)
    const len = binaryString.length
    const wasmBytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      wasmBytes[i] = binaryString.charCodeAt(i)
    }
    const module = await WebAssembly.instantiate(wasmBytes.buffer, {})
    XzReadableStream._moduleInstance = module.instance
  }

  constructor(compressedStream: ReadableStream<Uint8Array>) {
    let xzContext: XzContext | undefined
    let unconsumedInput: Uint8Array | null = null
    const compressedReader = compressedStream.getReader()

    super({
      async start(controller) {
        await XzReadableStream._contextMutex.acquire()

        try {
          if (!XzReadableStream._moduleInstance) {
            await (XzReadableStream._moduleInstancePromise ||
              (XzReadableStream._moduleInstancePromise =
                XzReadableStream._getModuleInstance()))
          }
          xzContext = new XzContext(XzReadableStream._moduleInstance!)
        } catch (error) {
          XzReadableStream._contextMutex.release()
          throw error
        }
      },

      async pull(controller) {
        try {
          const ctx = xzContext!
          ctx._refresh()
          if (ctx.needsMoreInput()) {
            if (unconsumedInput === null || unconsumedInput.byteLength === 0) {
              const { done, value } = await compressedReader.read()
              if (!done) {
                unconsumedInput = value
              }
            }
            const nextInputLength = Math.min(
              ctx.bufSize,
              unconsumedInput!.byteLength,
            )
            ctx.supplyInput(unconsumedInput!.subarray(0, nextInputLength))
            unconsumedInput = unconsumedInput!.subarray(nextInputLength)
          }

          const nextOutputResult = ctx.getNextOutput()
          controller.enqueue(nextOutputResult.outChunk)
          ctx.resetOutputBuffer()

          if (nextOutputResult.finished) {
            ctx.dispose()
            XzReadableStream._contextMutex.release()
            controller.close()
          }
        } catch (error) {
          if (xzContext) {
            xzContext.dispose()
          }
          XzReadableStream._contextMutex.release()
          throw error
        }
      },
      cancel() {
        try {
          if (xzContext) {
            xzContext.dispose()
          }
          return compressedReader.cancel()
        } finally {
          XzReadableStream._contextMutex.release()
        }
      },
    })
  }
}
