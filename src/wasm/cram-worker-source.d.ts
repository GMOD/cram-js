/**
 * The bundled slice-decode worker, as a string the pool turns into a Blob URL.
 *
 * Hand-written because the generated bundle is a single huge string literal and
 * tsc's inferred type for it is unusable in a declaration file. See docs/WASM.md
 * for why co-located types are the pattern here.
 */
declare const workerSource: string
export default workerSource
