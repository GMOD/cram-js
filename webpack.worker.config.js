import path from 'path'
import { fileURLToPath } from 'url'

import TerserPlugin from 'terser-webpack-plugin'

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
    // NOT src/wasm, where this used to land. `allowJs` makes everything under
    // src/ a tsc input, so this intermediate was compiled to both esm/ and
    // dist/ and published three times over with two sourcemaps — ~1 MB of an
    // artifact nothing imports. Only the string module inline-worker.sh derives
    // from it is real, and that one does belong in src/wasm and in git.
    path: path.resolve(__dirname, 'build/worker'),
    filename: 'cram-worker-inlined.js',
    iife: true,
  },
  optimization: {
    minimizer: [
      // Keep the license banners in the bundle instead of webpack's default of
      // extracting them to a sidecar .LICENSE.txt. The bundle here is not a
      // file we ship — it becomes a string inside one — so an extracted notice
      // would be left behind in build/ while the code it covers (is-buffer,
      // MIT) travelled on into every consumer with a banner pointing at a file
      // that does not exist.
      new TerserPlugin({ extractComments: false }),
    ],
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
