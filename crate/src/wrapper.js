import wasmData from '../../src/wasm/inflate_wasm_bg.wasm'
import * as bg from '../../src/wasm/inflate_wasm_bg.js'

let wasm = null
let initPromise = null

async function init() {
  if (wasm) {
    return wasm
  }

  if (!initPromise) {
    initPromise = (async () => {
      const response = await fetch(wasmData)
      const bytes = await response.arrayBuffer()
      const { instance } = await WebAssembly.instantiate(bytes, {
        './inflate_wasm_bg.js': bg,
      })
      wasm = instance.exports
      bg.__wbg_set_wasm(wasm)
      return wasm
    })()
  }

  return initPromise
}

export async function inflate(input) {
  await init()
  return bg.inflate(input)
}

export async function inflateZlib(input) {
  await init()
  return bg.inflate_zlib(input)
}

export async function inflateGzip(input) {
  await init()
  return bg.inflate_gzip(input)
}
