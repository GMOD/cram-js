import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // profile-longreads connects the V8 inspector and parses an ONT long-read
    // CRAM ten times to write a .cpuprofile — minutes of work that asserts
    // nothing. `preversion` runs the whole suite on every release, so it does
    // not belong in the default run; `pnpm test:profile` runs it on demand.
    // .claude/ holds agent worktrees — whole checkouts of this repo inside it,
    // which the include glob would otherwise run a second copy of the suite
    // from. Spread the defaults rather than replacing them, or node_modules
    // gets collected.
    exclude: [
      ...configDefaults.exclude,
      '**/.claude/**',
      'test/profile-longreads.test.ts',
    ],
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
