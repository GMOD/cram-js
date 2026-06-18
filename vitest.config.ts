import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // the htscodecs wasm decode paths are slow to transform/run, especially on
    // throttled hardware; give tests and setup hooks generous headroom so the
    // suite is not flaky under load
    testTimeout: 60000,
    hookTimeout: 60000,
    snapshotFormat: {
      maxOutputLength: Infinity,
    },
  },
})
