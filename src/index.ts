export { CramRecord, default as CramFile } from './cramFile/index.ts'
export { default as CraiIndex } from './craiIndex.ts'
export { default as IndexedCramFile } from './indexedCramFile.ts'

// WASM codec exports (for advanced users who want direct access to WASM decoders)
export {
  wasm_decode_gamma_bulk,
  wasm_decode_beta_bulk,
  wasm_decode_subexp_bulk,
  wasmCodecsAvailable,
} from './htscodecs-wasm.ts'
export type { CramCursor } from './htscodecs-wasm.ts'
console.log('H2')
