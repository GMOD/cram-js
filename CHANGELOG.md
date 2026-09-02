## [14.0.0](https://github.com/GMOD/cram-js/compare/v13.4.3...v14.0.0) (2026-09-02)

### Chores

- Pin the wasm build to emscripten 6.0.6 on both sides ([dddcad5](https://github.com/GMOD/cram-js/commit/dddcad50a474f3fd2ecc40f5e7366417d99f3b03))

### Documentation

- HEAPU8.slice in copyFromWasm, measured and not taken ([4b05155](https://github.com/GMOD/cram-js/commit/4b05155cf67ae994d672a47183264ff59f931d5a))

### Features

- **BREAKING** A record is a view onto its slice's columns, and a slice is one read ([04c05a6](https://github.com/GMOD/cram-js/commit/04c05a6b68f0c64631aee859338460f3d2f367ca))
- RecordClass, so a consumer's per-read object can be the record ([91b4926](https://github.com/GMOD/cram-js/commit/91b4926c3ac0e8a41f3c9919f264deb44ee3b9fd))
- **BREAKING** Weigh the decoded-slice cache in bytes ([5e344e6](https://github.com/GMOD/cram-js/commit/5e344e64225970133e05afabc72397655398be0e))
- Type the record class through CramFile and IndexedCramFile ([424c58d](https://github.com/GMOD/cram-js/commit/424c58d8c16168418419e191204d3f99173b3f6c))

### Performance Improvements

- Fetch a slice's reference alongside its decode, not after it ([674bef2](https://github.com/GMOD/cram-js/commit/674bef22d620cee4bf1a8e136a8a489ce9d259ea))
- Read a container header in one speculative read ([39e4b0b](https://github.com/GMOD/cram-js/commit/39e4b0b56149b77b6104a7fa70700f33e8154ff3))

## [13.4.3](https://github.com/GMOD/cram-js/compare/v13.4.2...v13.4.3) (2026-08-31)

### Chores

- Make the wasm build's sed work off Linux ([c625dd3](https://github.com/GMOD/cram-js/commit/c625dd31b894329115df852d6f3cb1e7fd1bb818))

### Documentation

- Record why the lzma module stays base64 ([13788b5](https://github.com/GMOD/cram-js/commit/13788b58f9bac71ad6b4a5cec53fe359726f9a8b))
- Say what the read pattern actually is before recommending the range cache ([d367ffe](https://github.com/GMOD/cram-js/commit/d367ffe93856ab4849ab3a0951cdf31efb570003))

### Features

- CramRecord.end reports bam_endpos semantics ([0a53bef](https://github.com/GMOD/cram-js/commit/0a53bef8a41f1ca4b18281de18c83b8511b0a245))

### Tests

- Assert the read pattern the README describes ([f3d50d2](https://github.com/GMOD/cram-js/commit/f3d50d26dae658006b3d44e27ebf170d56956184))

## [13.4.2](https://github.com/GMOD/cram-js/compare/v13.4.1...v13.4.2) (2026-08-21)

### Bug Fixes

- Take the shared-read-cache release that fixes abort, eviction and weighing ([4e972c9](https://github.com/GMOD/cram-js/commit/4e972c96922f77731ec6e908bece06e9cd383727))

### Documentation

- Point at @gmod/range-cache-filehandle for HTTP reads ([dc1ca93](https://github.com/GMOD/cram-js/commit/dc1ca9354bb34c01fc2b19b35d0ffa6d15956a4f))
- Name hic in the dataflow diagram's SYNC header ([bd54007](https://github.com/GMOD/cram-js/commit/bd54007cb34603b8dafc6ebc427c2bba8e87e467))
- Record why block decompression does not go on the GPU ([a8980c1](https://github.com/GMOD/cram-js/commit/a8980c141db1030d4ae059b5d59da22c535177d2))
- Point remote readers at @gmod/range-cache-filehandle ([298d174](https://github.com/GMOD/cram-js/commit/298d174d1caf2400d9045a7248abcc62b59c4cbb))

## [13.4.1](https://github.com/GMOD/cram-js/compare/v13.4.0...v13.4.1) (2026-08-16)

### Bug Fixes

- Carry a lossy read name past the second segment of a mate chain ([3bfc737](https://github.com/GMOD/cram-js/commit/3bfc73740f6b7b3a83ffcf92ebe7f8194c520341))

### Chores

- Regenerate the stale worker bundle ([436904d](https://github.com/GMOD/cram-js/commit/436904d235ae0ece26cf4829645573c7ad3fac66))

### Documentation

- Record why uniqueId carries the slice offset as well as the counter ([7c12f98](https://github.com/GMOD/cram-js/commit/7c12f98eae0cd2f9ac8b1b65908ded9b77593808))
- ADR 0011 was wrong that no file reaches the mate-walk hole ([cebce95](https://github.com/GMOD/cram-js/commit/cebce95a2499ada4c9d6454a95709ad692e9d85f))
- Trim ADR 0011 and the comments around it ([387811b](https://github.com/GMOD/cram-js/commit/387811b538af92d83d6e83efd7bfd192e2a68939))

### Tests

- Assert no CRAM in the corpus hands out a uniqueId twice ([8f7128f](https://github.com/GMOD/cram-js/commit/8f7128fdf9134fe19ad16c863e9d562f4f211fb5))
- A real CRAM that reaches the second link of the mate walk ([461b358](https://github.com/GMOD/cram-js/commit/461b3580daf46847f686a25229dbe17f8a4d10b7))
- Sweep the corpus for records that decode without a name ([3ef3bc7](https://github.com/GMOD/cram-js/commit/3ef3bc72d3a3371863379891ab1a1cef37d72908))

## [13.4.0](https://github.com/GMOD/cram-js/compare/v13.3.0...v13.4.0) (2026-08-16)

### Bug Fixes

- Keep a parked wasm experiment under src/ out of the build ([bcbb19d](https://github.com/GMOD/cram-js/commit/bcbb19d598c0d80ad9c1c55510c6eb0c58153594))
- Bound the worker's parsed-scheme cache ([508b74e](https://github.com/GMOD/cram-js/commit/508b74e32eefd39f4520f9b297952be65b7c2010))
- A worker that cannot start hung every read of the file ([5606b02](https://github.com/GMOD/cram-js/commit/5606b02d2133c0c3c5a96e1e2b0a0a67cd69abce))
- Export the error classes, which no consumer could reach ([e0f2e78](https://github.com/GMOD/cram-js/commit/e0f2e7813f1ab6ed28cce062953530f036923601))
- Forward the query's decode options to the mate slices ([99b25cc](https://github.com/GMOD/cram-js/commit/99b25ccc66ea6ed233d5271ee7f053ed27776e27))
- Don't cache a rejected wasm instantiation ([7060dbf](https://github.com/GMOD/cram-js/commit/7060dbf33d05b61ad6a2e2b58184447afeda74e8))
- A block that will not decode is a CramMalformedError ([c8888aa](https://github.com/GMOD/cram-js/commit/c8888aa4a07a7cf795cf3f3ecc4b9393f8c47928))
- A raw QS block kept the whole slice reachable ([c9de577](https://github.com/GMOD/cram-js/commit/c9de57741038ce3fe3ea78531930ef734f7f5d98))
- The worker's scheme cache confused two files whose containers coincide ([4937971](https://github.com/GMOD/cram-js/commit/49379716ce69a3aa0efe3df29bbced74d0b16ec9))
- A worker whose wasm will not load hung the pool's startup timeout ([b6acc72](https://github.com/GMOD/cram-js/commit/b6acc72f31bfab92a150e7f1d3a99c438d4f11cd))
- Gamma and huffman read past the end of the core block ([f958414](https://github.com/GMOD/cram-js/commit/f958414d17da249194e0e8a8b3648412f0947b7a))

### Chores

- Keep agent worktrees out of the toolchain's way ([bf191c3](https://github.com/GMOD/cram-js/commit/bf191c39f3f437b40d8aeeff594be040fb113aa0))
- Drop three dependencies nothing imports ([c6735ac](https://github.com/GMOD/cram-js/commit/c6735ac1cdc14d07aef69ab2833496f791674f55))
- Build each ref in a worktree ([72501fc](https://github.com/GMOD/cram-js/commit/72501fc04cda7535fc5476263f8a3e64806a3bb2))

### Documentation

- A dataflow diagram, and where the wasm boundary sits and why ([5b97827](https://github.com/GMOD/cram-js/commit/5b978272e8a1cb9aa0bef6ceabda108fcea8992f))
- What the worker pool costs in memory, which MEMORY.md never counted ([adf8b92](https://github.com/GMOD/cram-js/commit/adf8b928025286cbbde88759c183a08a8340c458))
- The worker bundle is code-split, and only the lzma module is base64 ([1a26e35](https://github.com/GMOD/cram-js/commit/1a26e350ca85a2562221dbe42ae58acabf08cde1))
- Drop a stray tool-call artifact from the end of WASM.md ([074eadf](https://github.com/GMOD/cram-js/commit/074eadfbc4e3b595473088e072e9e1ee6eb305ea))
- WASM.md said four things twice, and stop narrating past edits ([511de6c](https://github.com/GMOD/cram-js/commit/511de6c9c2a520182628a52738c44024f85e68e1))
- Trim a few sentences that restated their own paragraph ([59eae65](https://github.com/GMOD/cram-js/commit/59eae65a88d63967d9ab3aab3f1124cc68bbe728))
- Trim the change history out of the comments this work added ([ec44f9a](https://github.com/GMOD/cram-js/commit/ec44f9a41f6eefe87498c740cd680f01ae7c7bd5))
- The scheme cache is keyed on a position, not an identity ([b1735da](https://github.com/GMOD/cram-js/commit/b1735da2d79b370b420ea077b0bf1f3528e4e4cf))
- Drop a version number from a test comment ([88dcad6](https://github.com/GMOD/cram-js/commit/88dcad683621e7d785149b276b2caad78bcdffdc))
- A CONTRIBUTING.md, with the release steps out of the README ([048c171](https://github.com/GMOD/cram-js/commit/048c171071aedaaf079f1f3ba81f6cf49869fda0))
- What validateChecksums buys, which nothing said ([99d9520](https://github.com/GMOD/cram-js/commit/99d952099553737e2063217ec0b1b6fe168ab927))
- An editing pass over the README and docs/ ([88ab6db](https://github.com/GMOD/cram-js/commit/88ab6dbb74aace378e6fd457f07a6bc891bcc194))
- An optimizations.md, the query path in one pass ([dae5a44](https://github.com/GMOD/cram-js/commit/dae5a4448ff08ddaca0876216dfc31a8b9ec0cc5))
- One line per entry in the README docs list ([dc28b70](https://github.com/GMOD/cram-js/commit/dc28b708439e8c543a3e0168949a63a2bf19469a))
- A dataflow.md, so the diagram has prose around it ([a0147db](https://github.com/GMOD/cram-js/commit/a0147db89a3ef6965ecc726f64bc382b85b95a25))
- Lowercase the docs/ filenames ([06d8c19](https://github.com/GMOD/cram-js/commit/06d8c197485eda3249411515c6e144bd85416956))
- Re-measure payloadOffsets, which is a trade and not a free win ([5a55200](https://github.com/GMOD/cram-js/commit/5a55200540536358ea159c3805e433b6a2f8ab7f))
- ADR 0010 for the payload checkpoints, and refPos takes its place in TODO ([e703647](https://github.com/GMOD/cram-js/commit/e703647451c94c2b0ead31f741b0b416cbcaa7af))
- Generate the measured tables in memory.md, and fix the stale ones ([aad5a72](https://github.com/GMOD/cram-js/commit/aad5a725926b77b0beab129c8b89017bc67ef7b6))
- Simplify the dataflow diagram ([da518b3](https://github.com/GMOD/cram-js/commit/da518b3ab251a7e1858c76f1e0378ddd3a9bd6e9))
- Name the read-feature arena in the dataflow doc ([9dfebb1](https://github.com/GMOD/cram-js/commit/9dfebb14be6ab0dd64ab6d5b990579eafbf0095a))
- Show the columnar output in the dataflow figure ([8d5afd5](https://github.com/GMOD/cram-js/commit/8d5afd5a4c055c005da0d5c7fc3b4006c3f4e387))
- Call the cram decode cluster a worker pool, as bam-js does ([c6c16ce](https://github.com/GMOD/cram-js/commit/c6c16ce01e470e75a9ab60a6f4d532093cc57d1c))
- Fix a stray 'there' in the worker pool paragraph ([514f807](https://github.com/GMOD/cram-js/commit/514f8078729dbff88503e9db09f6ad0ad073b2f4))
- Give the worker pool its own legend color ([f34c7d9](https://github.com/GMOD/cram-js/commit/f34c7d99a5f5d6eb1784ffc30f646585c592a2f9))
- Recast the dataflow walkthrough as active-voice bullets ([218f670](https://github.com/GMOD/cram-js/commit/218f670b7931e16b0079800ccdae6a5bf3adc4f5))
- Drop the lone wasm module size from the dataflow and optimization docs ([f492968](https://github.com/GMOD/cram-js/commit/f492968f99eac9b10aabb02f1461d908a1006487))
- Put the prose in the active voice ([96584d5](https://github.com/GMOD/cram-js/commit/96584d513819b87e95f01f23f743d49a5c35b316))
- Put the README in the active voice ([b84eb7e](https://github.com/GMOD/cram-js/commit/b84eb7ee7c230ede5c53536a714795b48251b06a))
- Active voice in ADR 0010, and correct the release command in CONTRIBUTING ([27029e9](https://github.com/GMOD/cram-js/commit/27029e99a8b45ba38c13f179f16019b2f4ff66d1))
- Say what a no_ref file does to getMismatches without a reference ([b686c5c](https://github.com/GMOD/cram-js/commit/b686c5ca7d066a8bccce3c1ccca98497000d02b3))
- Correct the no_ref size penalty, and say who actually pays for it ([35ffa3e](https://github.com/GMOD/cram-js/commit/35ffa3ef9cfc033977df3179fc098b27b7568ed5))

### Features

- Report the substitutions hidden inside a no_ref file's 'b' runs ([56013f5](https://github.com/GMOD/cram-js/commit/56013f56c71a438303099f082bfe9152b2311eea))

### Other Changes

- Move graphviz dataflow diagram into docs/img/ ([5982e36](https://github.com/GMOD/cram-js/commit/5982e36e95bb897865762937016924f4e296c6d1))
- Restyle cram dataflow diagram to match bam-js/tabix-js palette and legend ([d283397](https://github.com/GMOD/cram-js/commit/d283397306b50d3fb9ceb9b6ec56f67819a41341))
- Narrow cram dataflow layout and bump font size for legibility at README width ([e699e30](https://github.com/GMOD/cram-js/commit/e699e30f0677075516966ce0762004add436ceb1))

### Performance Improvements

- Size the read-feature arena from the slice's blocks instead of growing it ([573bd9d](https://github.com/GMOD/cram-js/commit/573bd9d1fdd273edf949c28e17a75ba0521b9475))
- The payload arena fell short wherever B or i features appear ([7db5bfe](https://github.com/GMOD/cram-js/commit/7db5bfecaeefbb87d7c73c80be51de2f06e9b95f))
- Checkpoint the payload offsets instead of storing one per slot ([fe94cad](https://github.com/GMOD/cram-js/commit/fe94cadbb852ae1e884d8c84c2689ba17de1b090))
- Carry the payload offset through the walk ([1c2b2f4](https://github.com/GMOD/cram-js/commit/1c2b2f48d379bc3a0a76da4f05050857ca117408))

### Refactoring

- A pool that loses a slice returns undefined, not an error class ([11c97e0](https://github.com/GMOD/cram-js/commit/11c97e0ce2ef20e4c27fd30108acc2d9025e74f1))
- One list of data series, and a named type for a record's arguments ([d966e59](https://github.com/GMOD/cram-js/commit/d966e59270274209a72139b2f4830f9212cc44b2))

### Tests

- Cover no_ref 'b' runs at long-read scale, and record what they cost ([afe5e65](https://github.com/GMOD/cram-js/commit/afe5e6542f01a6596d8618f97dd94ea0daaab83b))

## [13.3.0](https://github.com/GMOD/cram-js/compare/v13.2.0...v13.3.0) (2026-08-14)

### Documentation

- Bgzf-filehandle does build its worker bundle, contrary to this note ([1a87a94](https://github.com/GMOD/cram-js/commit/1a87a944b9b79b35e92240e3a7155fe47e50ac19))
- ADR 0009, why the pool is per context rather than shared across them ([3b7be55](https://github.com/GMOD/cram-js/commit/3b7be559a7c5273030171f27cddd9ba444ab3aee))
- The pool's win grows with the region, and where a consumer can reach it ([a938be0](https://github.com/GMOD/cram-js/commit/a938be005fe9f38c5122791ba4a7239cbdb5cc13))

### Performance Improvements

- Code-split the worker bundle, halving what a consumer bundles ([ba940cc](https://github.com/GMOD/cram-js/commit/ba940ccceb44bc49751f8e5fd145c9f8990a1429))

## [13.2.0](https://github.com/GMOD/cram-js/compare/v13.1.0...v13.2.0) (2026-08-12)

### Bug Fixes

- Forward the slice-pool options through IndexedCramFile ([11f8f64](https://github.com/GMOD/cram-js/commit/11f8f6497892d1c73d19a1edd5346dd737313a3c))

### Chores

- Stop publishing the worker build's intermediates ([da7cdbc](https://github.com/GMOD/cram-js/commit/da7cdbcdb078841806ea18f780eabb1fc3a3e18d))

### Documentation

- Record what ADR 0008 actually bought, now that jbrowse has taken it ([d265c95](https://github.com/GMOD/cram-js/commit/d265c9543f20b50ef96043de3de4747187021a9e))
- Correct ADR 0008's numbers, and record the harness trap behind them ([f90d93a](https://github.com/GMOD/cram-js/commit/f90d93a9c368f63967f32abfee9f1cc661495ff6))
- Measure the pool in a browser, nested inside another worker ([d7145df](https://github.com/GMOD/cram-js/commit/d7145df03178f4cda6aae70e6be1e6a48d9181f8))
- Name the browser bundle, the worker pool, and retire two landed TODOs ([cbf1857](https://github.com/GMOD/cram-js/commit/cbf185756891783b03b01359314cb165baa9192f))

### Tests

- Let test:pack see the shape of the tarball, not just its behaviour ([2acf69e](https://github.com/GMOD/cram-js/commit/2acf69e2172b0b71f097f81c6b8eabd192e6dc08))

## [13.1.0](https://github.com/GMOD/cram-js/compare/v13.0.0...v13.1.0) (2026-08-11)

### Bug Fixes

- Regenerate the worker bundle from a current esm/ ([c71f133](https://github.com/GMOD/cram-js/commit/c71f13351b282340bea54269aa1a7a1983fc5e20))

### Chores

- Regenerate the worker bundle for the rebased base ([accd9a9](https://github.com/GMOD/cram-js/commit/accd9a964d103fd9eb77984ac8edeea07d8a7481))

### Documentation

- Measured numbers for the slice pool, and the threshold that was rejected ([3f25135](https://github.com/GMOD/cram-js/commit/3f2513590817379eb5a58db02aad97532e2aeda8))

### Features

- A transfer protocol for decoded slices ([8a64d70](https://github.com/GMOD/cram-js/commit/8a64d703aae9324d3335b16f2554223e686e8dd3))
- Decode a slice from its bytes alone ([dfde75e](https://github.com/GMOD/cram-js/commit/dfde75efe49a24d135696e86abcf9de7741743b7))
- Decode slices on a worker pool ([e5dce80](https://github.com/GMOD/cram-js/commit/e5dce8022c0c4d245a4b5a1c5fa8cefcf87831ef))

### Refactoring

- Lift block parsing and decompression out of CramFile ([07ac8c6](https://github.com/GMOD/cram-js/commit/07ac8c67efb6cc86937c8c8a588ad1a0cb385639))

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
