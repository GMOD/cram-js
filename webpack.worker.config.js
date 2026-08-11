import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Bundles the slice-decode worker into one file, which
 * `scripts/inline-worker.sh` then wraps as a string module so the pool can
 * launch it from a Blob URL with no consumer wiring.
 *
 * Runs against `esm/`, not `src/`, so the worker is built from the same tsc
 * output the package ships rather than from a second compilation of its own.
 *
 * `target: 'webworker'` matters: the default web target emits DOM-only globals,
 * and the htscodecs bundle is already built with emscripten's
 * `ENVIRONMENT='web,worker'` (see docs/WASM.md) so it initialises fine here.
 */
export default {
  mode: 'production',
  target: 'webworker',
  entry: './esm/worker/sliceWorkerEntry.js',
  output: {
    path: path.resolve(__dirname, 'src/wasm'),
    filename: 'cram-worker-inlined.js',
    iife: true,
  },
  performance: {
    // the inlined htscodecs wasm is ~130 KB of base64 on its own, so the size
    // hint here is noise rather than a signal
    hints: false,
  },
  resolve: {
    fallback: { fs: false },
  },
}
