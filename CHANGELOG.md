## [13.0.0](https://github.com/GMOD/cram-js/compare/v12.0.1...v13.0.0) (2026-08-11)

### Chores

- Enforce type strippability in tsconfig ([3b8f925](https://github.com/GMOD/cram-js/commit/3b8f925d0928de0865c5e167bc0855547355dc22))
- Keep eslint out of agent worktrees ([630be64](https://github.com/GMOD/cram-js/commit/630be646ed761e1b445cf79b571cf44996a3a4ef))

### Features

- **BREAKING** Half-open mismatch window, and an origin for the reported positions ([ed7799b](https://github.com/GMOD/cram-js/commit/ed7799bb8440a7b3c2dff67b20faf9a8a24f1025))

## [12.0.1](https://github.com/GMOD/cram-js/compare/v12.0.0...v12.0.1) (2026-08-11)

### Chores

- Create a GitHub release for each published tag ([f6e01b1](https://github.com/GMOD/cram-js/commit/f6e01b10582d70111d2843c78fd0058ae27d5e2f))
- Gitignore the local Claude settings and agent worktrees ([4d50411](https://github.com/GMOD/cram-js/commit/4d50411eae49576cf71f853b774aad20096c1fe9))

### Documentation

- Make TODO.md only open work, and move the rest to ADRs ([e67c614](https://github.com/GMOD/cram-js/commit/e67c61439a01556afcc80140f24f514dab4915fb))
- Fill the gaps in MIGRATION.md, and stop it pointing at a removed field ([1c12aa3](https://github.com/GMOD/cram-js/commit/1c12aa31c1dfa143546bb9bd25650827b1373699))
- Cut the README to what a new user needs, move the reference to docs/API.md ([453cbe2](https://github.com/GMOD/cram-js/commit/453cbe22685584b7aab83465ed44ede56b0076fb))
- Correct the slice-cache and mismatch-window docs, and drop the dead docs script ([59181b5](https://github.com/GMOD/cram-js/commit/59181b5d10577944596e146f5de72071eb6cc10f))

## [12.0.0](https://github.com/GMOD/cram-js/compare/v11.4.1...v12.0.0) (2026-08-11)

### Bug Fixes

- Make record.tags read-only loudly, and say so in the migration notes ([9bc951b](https://github.com/GMOD/cram-js/commit/9bc951bec9cd402fce19492c47a0ca45c0af81b9))

### Chores

- Render only the commit subject, and link the commit ([effa92f](https://github.com/GMOD/cram-js/commit/effa92fe3f19b9d97a583e069155bdc4b44e1447))

### Performance Improvements

- **BREAKING** Replace record.mate with two numeric fields ([6785856](https://github.com/GMOD/cram-js/commit/6785856cde7bd9bcf1925987b5a06168186bf11a))
- Store aux tags in a per-slice column, and add getTag ([8201605](https://github.com/GMOD/cram-js/commit/82016059cd448e8a601169720d71e4ff90056fe0))

### Refactoring

- Name the mate position fields for the next segment, as SAM does ([9e3dde5](https://github.com/GMOD/cram-js/commit/9e3dde5e0be0a11d03025eab3ecf1ee90f4abdc2))

## [11.4.1](https://github.com/GMOD/cram-js/compare/v11.4.0...v11.4.1) (2026-08-10)

### Bug Fixes

- Regenerate the wasm bundle under the emscripten version CI pins

### Chores

- Gate preversion on format:check, as CI does
- Gate preversion on typecheck too, as CI does
- Converge package.json on the shape its siblings use

### Other Changes

- Revert "chore: converge package.json" — the CHANGELOG prettier step ([ac7eb1e](https://github.com/GMOD/cram-js/commit/ac7eb1e905951d0fe350ed6832889b8844c672c1))

## [11.4.0](https://github.com/GMOD/cram-js/compare/v11.3.0...v11.4.0) (2026-08-10)

### Features

- CacheBudget, so several files can share one ceiling

## [11.3.0](https://github.com/GMOD/cram-js/compare/v11.2.0...v11.3.0) (2026-08-06)

### Performance Improvements

- Drop the 'batch' eviction policy, so cacheSize is a real bound

## [11.2.0](https://github.com/GMOD/cram-js/compare/v11.1.0...v11.2.0) (2026-08-06)

### Performance Improvements

- Size the slice cache above one query, not below it

## [11.1.0](https://github.com/GMOD/cram-js/compare/v11.0.0...v11.1.0) (2026-08-06)

### Features

- Reclaim decoded slices when nothing is using them

## [11.0.0](https://github.com/GMOD/cram-js/compare/v10.6.1...v11.0.0) (2026-08-06)

### Chores

- Type-check the tests and enforce prettier, as @gmod/bam does
- Let npm publish stop auto-correcting repository.url
- Exempt our own packages from the release quarantine
- Bump pnpm/action-setup to v6.0.10
- Run the test suite as `pnpm test --run`
- Emscripten 6.0.5 -> 6.0.6

### Documentation

- Correct what this cache shares with the rest of gmod

### Refactoring

- **BREAKING** Use @gmod/shared-read-cache for the slice record cache

## [10.6.1](https://github.com/GMOD/cram-js/compare/v10.6.0...v10.6.1) (2026-08-05)

### Chores

- Drop eslint-plugin-unicorn

### Refactoring

- Drop the unreachable doomed-entry check in SliceRecordCache

### Tests

- Pin that an already-aborted consumer cannot poison a shared decode

## [10.6.0](https://github.com/GMOD/cram-js/compare/v10.5.0...v10.6.0) (2026-08-05)

### Bug Fixes

- Stop the slice cache retaining a signal per cache hit

### Features

- Cancel a query with an AbortSignal

### Tests

- Exercise the pan case with overlapping regions, not identical ones

## [10.5.0](https://github.com/GMOD/cram-js/compare/v10.4.1...v10.5.0) (2026-08-05)

### Bug Fixes

- Decode a B read feature whose quality score is 0 as its base
- Throw rather than hang on a cyclic intra-slice mate chain
- Report a B read feature as a substitution when its base differs
- Pass the reference under the name v10 gave it

### Chores

- Type-check the tests too, and fix what that turned up

### Documentation

- Record what the string batching did to the memory table, and why the read name is not deferred
- Start an architecture decision record, and move the decisions into it
- Interning the decoded strings was tried and is not worth it

### Other Changes

- Bump deps

### Performance Improvements

- Binary-search the .crai for a range instead of filtering every slice
- Resolve base substitutions through numeric tables, not strings
- Settle the read name's NUL terminator by its last byte
- Bind the tag fast path on the values codec alone
- Decode a slice's read names in one pass, not one call per record
- Read a Z tag's value from its block the way a read name is read
- Read a fixed-width tag as a number, not as a one-element array

### Refactoring

- Give the self-clearing async memoize one home, and drop a dead module
- Drop an unused error class, and say what containerCount counts
- Read the section parsers through a cursor instead of offset arithmetic
- Let each codec bind its own fast path

### Tests

- Pass the reference under the name v10 gave it, and compare every field
- Hold the four tolerated samtools discrepancies to exact equality
- Arbitrate the unsorted fixtures too, and assert what parse.test claimed
- Drop the unmapped-CIGAR blanking, following @gmod/bam

## [10.4.1](https://github.com/GMOD/cram-js/compare/v10.4.0...v10.4.1) (2026-08-05)

### Bug Fixes

- Return reads overlapping the query start by one base

### Tests

- Check every indexed CRAM against samtools, and keep zero-span reads
- Walk only references that hold records, and reuse one reader
- Keep the samtools comparison off the network
- Fail in CI when samtools is missing

## [10.4.0](https://github.com/GMOD/cram-js/compare/v10.3.0...v10.4.0) (2026-08-04)

### Documentation

- Note what moving the reference into the decode costs on the error path

### Features

- Answer the trailing clip in O(1) too, and pin both against the walk

### Tests

- Pin the two read-base reconstructions against each other

## [10.3.0](https://github.com/GMOD/cram-js/compare/v10.2.0...v10.3.0) (2026-08-04)

### Documentation

- Note what moved under CramRecord in 10.2.0
- Write up what was measured, including the two traps that misled it

### Features

- Add forEachCigarOp and getLeadingClipLength, and halve long-read bases

### Performance Improvements

- Apply the reference to a slice's records once, not once per query

### Refactoring

- Drop dead code, and say what checkSequenceMD5 actually defaults to

### Tests

- Cover the new cigar module in the packed-artifact smoke test

## [10.2.0](https://github.com/GMOD/cram-js/compare/v10.1.0...v10.2.0) (2026-08-01)

### Chores

- Add git-cliff for changelog generation

### Documentation

- Move the raw read-feature reference into its own page, warm up the README
- Move the raw read-feature reference into its own page, warm up the README
- Add a page on the wasm decoding path, its speed and its memory use
- Backfill CHANGELOG.md for v3.0.1 through v10.1.0
- Mark breaking changes in the generated changelog
- Write up the memory techniques on their own page

### Performance Improvements

- Stop evicting the slices of the query still in flight
- Decode quality scores into a per-slice column
- Decode read names during the slice decode

### Refactoring

- Build the slice decode context in its own module

### Upgrade notes

Reading a `CramRecord` is unchanged — every documented property returns what it
did in 10.1.0, and `toJSON()` output is byte-identical. Three things moved
underneath that are observable if you were doing something unusual with a
record:

- `record.qualityScores` is now a getter over the slice-wide `qualityColumn`,
  not an own field. Assigning it throws instead of silently working, and it
  returns a fresh view per access, so
  `record.qualityScores !== record.qualityScores`. Writing through a view still
  persists — it writes into the column. Use `qualityScoreAt(pos)`, or hoist
  `qualityColumn`/`qualityStart` for a per-base loop.
- Own-property enumerability flipped for two fields: `readName` is now an own
  field and `qualityScores` is not, so `{...record}` and `Object.keys(record)`
  gained the first and lost the second. `toJSON()` is unaffected.
- `record._syntheticReadName` is gone; lossy-name records get their synthetic
  name written straight to `readName`.

# v10.1.0

- Decompress gzip blocks with libdeflate instead of zlib. libdeflate has a
  one-shot API instead of zlib's resumable grow-and-retry loop, which is both
  faster (measured 1.12-1.37x) and removes the class of hang fixed below
- Fix `zlib_uncompress` spinning forever (100% CPU, unrecoverable) on a
  truncated or corrupt deflate stream
- Add `CramFile.getReferenceInfo()`, `getReferenceId(name)`, and
  `getReferenceName(refId)`, derived from the SAM header, so callers no longer
  have to build their own refId<->name map to use `getRecordsForRange` and
  `fetchReferenceSequence` by contig name
- Upgrade bundled htscodecs wasm build to emscripten 6.0.5
- Move the v9->v10 coordinate migration notes out of the README into
  MIGRATION.md; clean up dense README reference lists into tables

# v10.0.0

- **Breaking:** coordinates are now 0-based half-open throughout, replacing the
  previous 1-based closed convention (matching htslib and @gmod/bam). See
  MIGRATION.md for the full list of renamed/changed APIs
  (`alignmentStart`->`start`, `seqFetch`->`fetchReferenceSequence`,
  `getRecordsForRange`, `readFeature.pos`/`.refPos`, `Mismatch.refPos`,
  `CraiIndex` entries)

# v9.0.0

- **Breaking:** `CramRecord.readFeatures` is now a getter that rebuilds an array
  of objects from a per-slice `ReadFeatureArena` of typed-array columns on each
  access; assigning to it now throws. Reading it is unchanged in shape and
  values. Cuts retained heap for a decoded slice substantially (measured -64% on
  ONT long reads, -17% to -20% on short reads)
- Add `record.getMismatches(opts?)` and `record.forEachMismatch(cb, opts?)` to
  read the differences from the reference (X/I/D/N/S/H) without hand-parsing
  read features
- Fix `getCigarString()` returning `''` instead of `'*'` for a mapped record
  with no cigar operations

# v8.7.0

- Fix the decoded-slice cache being unbounded instead of bounded by record count
  as documented
- Share one reference-region object across a slice's records, and read a block
  header's two leading bytes without a DataView, for less GC pressure
- Remove unused `CramRecord.qualityScoreAt`

# v8.6.1

- Fix `parseLtf8` returning wrong values for numbers above 2^31
- Fix `getReadBases()` hanging forever on malformed read features
- Build huffman tables in one pass and drop dead code
- CI: sha-pin actions, take pnpm version from the `packageManager` field, node
  24

# v8.6.0

- Fix `getPairOrientation` to derive orientation from mate position instead of
  template length

# v8.5.0

- Fix bounds-checking of pre-decoded int blocks and honor the `decodeTags`
  default
- Parse `.crai` entries numerically instead of building a string per digit
- Mark the package `sideEffects: false` for better tree-shaking

# v8.4.0

- Add `getCigarString()` to `CramRecord`
- Upgrade bundled htscodecs wasm build to emscripten 6.0.2
- Guard `seqFetch` so it bypasses the embedded reference and stays bounded to
  the read extent

# v8.3.1

- Report `.crai` index download progress via `onProgress`

# v8.3.0

- Report download progress from `getRecordsForRange` via `onProgress`
- Fix decoding of RR (reference required) and AP (delta) tag encodings (#167)
- Note CRAM v3.1/v4 codec support in the docs

# v8.2.6

- Rewrite CODEC_SUPPORT.md and document the rans4x16 sub-variants and
  tok3-rans/arith dispatch

# v8.2.5

- Make the bundled wasm build reproducible (`SOURCE_DATE_EPOCH=0`); skip the
  wasm rebuild during `preversion` so it can't leave the worktree dirty

# v8.2.4

- Keep the bundled htscodecs wasm as a plain `.js` file instead of `.mjs`, strip
  `import.meta.url` usage
- Fix stale CI badge references

# v8.2.3

- CI: rename the merged workflow back to publish.yml, required for npm OIDC
  trust

# v8.2.2

- Drop `node` from the emscripten `ENVIRONMENT` for the inlined wasm bundle; the
  node init path pulled in `node:`-scheme imports that webpack 5 can't resolve
  for the browser build
- CI: merge publish into the push workflow gated on the full test suite; add a
  `test:pack` smoke test against the packed artifact

# v8.2.1

- Fix an EOF bounds check in the inlined ExternalCodec path, deduplicate
  `parseItf8`
- Treat zero-length blocks as empty regardless of compression method
- Fix `viewAsPairs` mate-slice dedup and tighten its types
- CI: use the official `emscripten-core/setup-emsdk` action

# v8.2.0

- Eliminate intermediate object allocations in record decoding: build
  `CramRecord` directly instead of destructuring a temporary object, and build
  mate records in their final shape
- Replace the string-keyed data-series decoder lookup with fixed-shape
  `BoundDecoders` for monomorphic dispatch (~22% faster on long-read decoding)
- Rewrite the README by hand, replacing documentation.js autogeneration
- Simplify package exports

# v8.1.0

- Batch ITF8 pre-decode ahead of the record loop and bind per-data-series decode
  closures at slice setup time, ~40% faster decoding
- Bump bundled htscodecs to v1.6.6
- Switch to pnpm, update TypeScript, remove `any` types, fix container caching
- Fix DataView construction, deduplicate `readBlock`
- Add CONTRIBUTING.md and a publish workflow

# v8.0.5

- Fix pair orientation calculation using isize sign correction

# v8.0.4

- Decode read names lazily (#163)

# v8.0.3

- Improve pair orientation speed with further bit hacks

# v8.0.2

- Optimize pair orientation calculation

# v8.0.1

- Use a 'slice size' fetch instead of repeated small fetches (#162)

# v8.0.0

- **Breaking:** `record.qualityScores` is now a `Uint8Array` instead of
  `number[]` (#160)

# v7.0.3

- Bump quick-lru
- Bump generic-filehandle2 for 0-length byte range requests

# v7.0.2

- Fix the ESM wasm build to exclude `node` from the emscripten `ENVIRONMENT`,
  fixing the browser bundle build under webpack 5

# v7.0.1

- Rebuild the bundled htscodecs wasm; split the build into separate ESM/CJS
  outputs

# v7.0.0

- **Breaking:** switch codec decoding from a hand-ported JS implementation to
  the real htscodecs C library compiled to WebAssembly via emscripten (#159),
  for broader and more accurate codec support

# v6.0.1

- Bump deps

# v6.0.0

- Vendor the xz-decompress dependency to drop the external package
- Extensive performance rework of rANS decoding (d04/d14/frequencies),
  ExternalCodec/byteArrayLength, and container/slice reading
- Add a compatibility test suite validated against samtools view output
- Bump pako-esm2

# v5.1.0

- Replace pako with pako-esm2 for the browser bundle

# v5.0.6

- Throw a clear error instead of hanging when given a non-CRAM file (e.g. a BAM
  file)
- Bump deps, ESM compatibility fixes

# v5.0.5

- Add a postbuild step

# v5.0.4

- Refactor the vendored seek-bzip stream class to ES6

# v5.0.3

- Refactor the vendored seek-bzip crc32 to an ES6 class

# v5.0.2

- Fix relative import extensions in the vendored seek-bzip module

# v5.0.1

- Bump deps

# v5.0.0

- Add an ESM build (#154)
- Bump generic-filehandle2

# v4.0.10

- Vendor the seek-bzip library, modified to avoid Buffer usage (#153)

# v4.0.9

- Remove unused bzip2 dependencies

# v4.0.8

- Swap the bzip2 implementation (#152)

# v4.0.7

- Fix a regression with bzip2 encoding introduced in v4 (#151)
- Make sure all encodings request `uncompressedSize` consistently

# v4.0.6

- Update ITF8 and LTF8 parsing (#150)
- Remove the file length check to help with CORS
- Simplify distribution: no separate error class export

# v4.0.4

- Replace the `long` dependency with `longfn` for LTF8 parsing
- Begin typescriptifying the htscodecs modules (rans, rans4x16, tok3)

# v4.0.3

- Bump deps

# v4.0.1

- Fix `io/index.ts` still re-exporting `LocalFile`/`RemoteFile` from
  `generic-filehandle` instead of `generic-filehandle2`

# v4.0.0

- **Breaking:** adapt to generic-filehandle2 (#147), replacing the unmaintained
  generic-filehandle dependency

# v3.0.7

- Fix some CRAM 3.1 codecs failing to parse (#144)

# v3.0.6

- Fix decoding of tag arrays of type "B,C" (#143)

# v3.0.5

- Remove dependency on `long` and `abortable-promise-cache`
- Migrate to vitest and eslint 9 flat config

# v3.0.4

- Replace buffer-crc32 with crc32

# v3.0.3

- Fix a missing explicit `Buffer` import
- Only run the build once during `build`

# v3.0.1

- Internal formatting cleanup (biome); expand snapshot test coverage

# v3.0.0

- Remove @gmod/binary-parser to avoid CSP violation for use of 'eval'/'new
  Function'

# v2.0.4

- Remove `fetchSizeLimit`
- Remove usage of `url` module

# v2.0.3

- Update sam header parsing to avoid breaking 'type contract'

# v2.0.2

- Update buffer-crc32
- Update typescript-eslint config and related fixes

# v2.0.1

- Fix issue parsing header tags with : character

# v2.0.0

- Add lzma support via xz-decompress. This uses webassembly, so it is a major
  version bump

# v1.7.4

- Fix import of bzip2 module

# v1.7.3

- Fix usage of the 'b' tag under situations in CRA4 where a Uint8Array is
  received instead of Buffer

# v1.7.2

- Update README.md with docs

# v1.7.1

- Re-export CramRecord class for typescript

# v1.7.0

- Typescript entire codebase, big thanks to @0xorial for taking on this effort!
- Update to use webpack 5 for UMD build

# v1.6.4

- Fix off by one in returning features from getRecordsFromRange

# v1.6.3

- Optimize CRAM parsing slightly (15% improvement on many short reads). This
  removes support for big endian machines
- Publish src directory for sourceMap

# v1.6.2

- Publish src directory for better source maps

# v1.6.1

- Explicitly use pako-esm2 for browser bundle to help avoid buggy zlib polyfills

# v1.6.0

- Support CRAMv3.1 (thanks to @jkbonfield for contributing!)
- Support bzip codec
- Remove localFile from the browser bundle using "browser" package.json field
- Add esm module field in package.json

# v1.5.9

- Fix CRAM not downloading proper records for long reads (pt2, PR #84)

# v1.5.8

- Fix CRAM not downloading proper records for long reads (pt1, PR #85)

# v1.5.7

- Add getHeaderText to CRAM to get SAM header

# v1.5.6

- Remove unnecessary rethor win tinyMemoize error handler
- Avoid uncaught promise from constructor

# v1.5.5

- Fix ability to reload CRAM file after failure
- Check if BAI file incorrectly submitted as index for CRAM

# v1.5.4

- Fix handling of hard clipping

# v1.5.3

- Improved README
- Upgrade to babel 7
- Upgrade @gmod/binary-parser
- Add fix for 'b', 'q', and 'Q' readFeatures

# v1.5.2

- Fix off-by-one error in range query
- Add webpack cram-bundle.js

# v1.5.1

- Add fix for when mate is unmapped

# v1.5.0

- Add lossy-names support
- Fix for mate strand

# v1.4.3

- Make sure mate exists for unmated pair, can exist when coordinate slices of
  cram file are made via samtools view

# v1.4.2

- Switch to es6-promisify for ie11
- Switch to quick-lru instead of lru-cache for ie11

# v1.4.1

- Add maxInsertSize for viewAsPairs

# v1.4.0

- Add viewAsPairs implementation

# v1.3.0

- Fix tests in node 6
- Make cram record unique IDs start at 1 instead of 0 to always be truthy
- Implement gamma and subexp codecs

# v1.2.0

- Add `getReadBases` docs
- Rewrite seq calculation to be much faster
- Implement ref fetching for multi-ref slices
