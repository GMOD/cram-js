# WebAssembly decoding

Every block codec except lzma is
[samtools/htscodecs](https://github.com/samtools/htscodecs) compiled to a single
WebAssembly module. gzip goes through libdeflate and bzip2 through the
emscripten bzip2 port. The module is inlined in the bundle and loads itself, so
there is nothing to set up.

lzma blocks go through a **second** wasm module. htscodecs has no lzma codec
(htslib links liblzma for those blocks), so `src/xz-decompress/` contains
[xz-embedded](https://tukaani.org/xz/embedded.html) as a separate 16 KB base64
module, instantiated from a `data:` URI. Only the streaming wrapper around it is
JS.

[dataflow.md](dataflow.md) shows where both sit in a query.

## Why

CRAM 3.1 was effectively unreadable in JS for years, and the reason was fqzcomp,
tok3 and the adaptive arithmetic coder. Between them that's thousands of lines
of context-modeling C, and porting it by hand means committing to keep a second
copy correct indefinitely. Compiling the real thing got all of it in one step,
including the rANS 4x16 and tok3 sub-variants that tools emit.

Because cram-js runs the same C that samtools runs, a block decodes to the same
bytes that `samtools view` gets, which answers whether it decoded correctly. To
pick up an upstream htscodecs fix, rerun the update script.

Speed follows from compiling the real C too. Most of the time spent decoding a
CRAM read goes to quality scores and read names, and compiled code now decodes
both in place of an interpreted inner loop. gzip uses libdeflate, which is quick
even by native standards.

Because the wasm is inlined, it behaves like any other JS dependency in node,
browsers and workers. It needs no second request, no static asset copied into
your build, and no MIME type or CSP rules.

## Where the boundary is drawn

Compiling the C is the easy half of the decision. The hard half is choosing
where the JS/wasm boundary sits, because every crossing copies its input into
the wasm heap and its output back out. Each of the four choices below names the
alternative it was picked over:

- **The unit is one block, not one record.** A block's two copies amortize over
  the thousands of records encoded in it. Crossing per record would multiply the
  copy count by roughly the record count, tens of thousands per slice, and would
  put a crossing inside the hot loop.

- **Everything above the block stays in JS**, meaning the per-data-series codecs
  (external, huffman, beta, gamma, subexp, byteArray\*) and the record decode
  itself. Those codecs are small bit readers over bytes that are already
  decompressed and already in the JS heap, so moving them into wasm gives no
  algorithmic win and costs a crossing per series per slice. Decoding whole
  slices in wasm would go further still, and would move the
  `fetchReferenceSequence` callback and the columnar output across the boundary
  too.

- **Decoders only.** The build leaves out the compressors and the
  SIMD-specialized htscodecs variants, because this library only reads. That is
  most of why the binary is 113 KB rather than the several hundred a full build
  would be.

- **One lazily-instantiated instance per JS context, for the life of the
  process.** Instantiation takes ~5 ms and runs on the first compressed block,
  not at import, so a consumer that opens a file and never queries it skips the
  cost. It runs once however many CRAMs are opened. In a worker it runs during
  the pool's init handshake instead (`warmupWasm`), so the first slice a user
  waits on does not also compile the module.

Inlining the wasm is a separate decision. Every consumer downloads a 128 KB
bundle, and in exchange needs no second request, static asset or CSP
configuration. A decoder is useless without its codecs, so we value a build with
no setup step over the bytes.

### Limitations

- **Two copies per block.** The codecs need a contiguous heap buffer, so every
  crossing at this boundary copies the block in and out. That copy cost is why
  the unit is the block and not the record.
- **The heap only grows** (see [Memory](#memory)), so peak tracks the largest
  single block ever decompressed.
- **The worker bundle contains a second copy** of the decoder and the wasm, so
  `src/wasm/cram-worker-source.js` is 395 KB (96 KB gzipped) in the published
  package; see [workers.md](workers.md#building-the-bundle). A bundler
  code-splits those bytes, because `sliceWorkerPool.ts` imports the bundle
  dynamically, from a function called only when a pool starts. The bundle
  therefore goes in a separate chunk that a consumer who never enables the pool
  never loads. In an esbuild bundle of `IndexedCramFile` + `CraiIndex`, the
  split cut an entry point from 534 KB to 268 KB.
- **No SIMD, no wasm threads**, which caps single-block throughput; the pool
  gets its parallelism from slices instead (see [Threading](#threading)).

## What it costs

|                             |                        |
| --------------------------- | ---------------------- |
| `src/wasm/htscodecs.js`     | 128 KB (55 KB gzipped) |
| wasm binary inside it       | 113 KB                 |
| instantiation               | ~5 ms, once            |
| wasm heap                   | 16 MB floor            |
| `src/xz-decompress/wasm.ts` | 16 KB, lzma only       |

**Only the lzma module is base64.** `src/xz-decompress/wasm.ts` is a
`data:application/wasm;base64,` URI, but the htscodecs bundle is not.
Emscripten's `SINGLE_FILE=1` writes the binary as a string of one character per
byte, unpacked by the `b[c] = ~f >> 8 & f` loop at the top of `htscodecs.js`, so
113 KB of wasm fits in a 128 KB file where base64 would have needed 151 KB. Keep
that in mind before trying to "fix" the encoding, or measuring the wrong thing.

The one-character-per-byte string is a property of emscripten's output, not a
better encoding that the lzma module lacks, and the lzma module stays base64 on
purpose. We measured converting it: the source drops from 16,810 to 13,730
bytes, but terser re-escapes the control bytes when it bundles, so the saving in
`dist/` is 634 bytes, or 1.7 KB gzipped. The size ratio does not explain the
different encodings either, since one character per byte costs 1.09x here
against base64's 1.33x, the same as for htscodecs.

The encodings differ because the two files are different kinds of artifact:

- `htscodecs.js` is build output. `pnpm build:wasm` regenerates it,
  `.prettierignore` skips it, and nobody opens it.
- `wasm.ts` was vendored once in e8e140c, has no generator, and goes through
  lint, format and typecheck. Emscripten's scheme writes control bytes into the
  source unescaped, 6,600 of them at this size. They would make git treat the
  file as binary, and a line-ending normalization could then corrupt it with no
  warning. The corruption would show up as an `instantiate` failure, with no
  generator to rebuild the file from. Base64 is inert ASCII, so it suits a blob
  maintained by hand.

Instantiation is async, so every decoder entry point in `src/htscodecs-wasm.ts`
is async too; after the first call, calls resolve against the existing instance.

## Memory

The heap starts at 16 MB and grows on demand, up to a 2 GB cap. A wasm heap can
only ever grow, since memory never goes back to the OS, so peak usage climbs to
the largest single block you decompress and stays there. Ordinary CRAM slices
never push it off the 16 MB floor.

Every allocation is freed before the decode returns, so the heap holds no
allocations between calls.

On a large query, the decoded records on the JS heap outweigh the wasm heap
anyway. `IndexedCramFile`'s `maxCacheBytes` option (default 1 GB) limits the
decoded slices the cache keeps there, and bulk consumers can read the columnar
`readFeatureArena` to skip materializing per-feature objects; see
[memory.md](memory.md#columns-not-objects).

## Threading

Decoding is single-threaded scalar code, with no wasm threads and no SIMD, so
one block decode uses one core. The parallelism comes one level up instead.
Slices are independent, and the pool in [workers.md](workers.md) decodes them
concurrently, one wasm instance per worker. The pool transfers slices rather
than sharing them, so the library needs no `SharedArrayBuffer` and therefore no
cross-origin isolation.

## Building

[codec-support.md](codec-support.md) has the update and rebuild scripts, and
`htscodecs-wasm/build.sh` has the emcc flags the numbers above come from.
