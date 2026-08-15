# WebAssembly decoding

Every block codec except lzma is
[samtools/htscodecs](https://github.com/samtools/htscodecs) compiled to a single
WebAssembly module. gzip goes through libdeflate and bzip2 through the
emscripten bzip2 port. The module is inlined in the bundle and loads itself, so
there is nothing to set up.

lzma is the exception, and it is a **second** wasm module rather than a JS
decoder: htscodecs has no lzma codec at all — htslib links liblzma for those
blocks — so `src/xz-decompress/` carries
[xz-embedded](https://tukaani.org/xz/embedded.html) as its own 16 KB base64
module, instantiated straight off a `data:` URI. Only the streaming wrapper
around it is JS. (This file used to say lzma was "the one decoder still written
in JS", which was wrong in both halves.)

[dataflow.dot](dataflow.dot) ([rendered](dataflow.svg)) shows where both sit in
a query.

## Why

CRAM 3.1 was effectively unreadable in JS for years, and the reason was fqzcomp,
tok3 and the adaptive arithmetic coder. Between them that's thousands of lines
of context-modelling C, and porting it by hand means signing up to keep a second
copy correct forever. Compiling the real thing got all of it in one step,
including the rANS 4x16 and tok3 sub-variants that tools do actually emit.

Running the same C samtools runs also settles the question of whether a block
decoded correctly: it decodes to the same bytes `samtools view` gets. When
htscodecs fixes something upstream, picking it up is a script rerun.

Speed comes along with that. Quality scores and read names are where a CRAM read
spends most of its decoding time, and those are now compiled code rather than an
interpreted inner loop. gzip gets libdeflate, which is quick even by native
standards.

And because the wasm is inlined, it behaves like any other JS dependency. No
second request, no static asset to copy into your build, no MIME type or CSP
rules, same story in node, browsers and workers.

## Where the boundary is drawn

Compiling C is the easy half of the decision. The half that decides whether it
pays is _where_ the JS/wasm boundary sits, because every crossing copies its
input into the wasm heap and its output back out. Four choices, each with the
alternative it was picked over:

- **The unit is one block, not one record.** A block's two copies amortise over
  the thousands of records encoded in it. Crossing per record would multiply the
  copy count by roughly the record count — tens of thousands per slice — and put
  the boundary inside the hot loop, which is the one place it must not be.

- **It stops at the block.** Everything above — the per-data-series codecs
  (external, huffman, beta, gamma, subexp, byteArray\*) and the record decode
  itself — stays in JS. Those codecs are small bit readers over bytes that are
  already decompressed and already in the JS heap, so moving them into wasm buys
  no algorithmic win and costs a crossing per series per slice. Going further
  still, decoding whole slices in wasm, would drag the `fetchReferenceSequence`
  callback and the columnar output across too. So the split is drawn exactly
  where the C is worth having: the block codecs are thousands of lines of
  context modelling (fqzcomp, tok3, the adaptive arithmetic coder), and the
  things above them are not.

- **Decoders only.** No compressor, none of the SIMD-specialized htscodecs
  variants — this library only ever reads. That is most of why the binary is 113
  KB rather than the several hundred a full build would be.

- **One lazily-instantiated instance per JS context, for the life of the
  process.** The ~5 ms is paid on the first compressed block, not at import, so
  a consumer that opens a file and never queries it pays nothing; and it is paid
  once however many CRAMs are opened. In a worker it is paid during the pool's
  init handshake instead (`warmupWasm`), so the first slice a user waits on is
  not also the one compiling the module.

The wasm being inlined is a separate axis, and the trade there is explicit: a
128 KB bundle every consumer downloads, in exchange for behaving like any other
JS dependency — no second request, no asset to copy into a build, no MIME type
or CSP rule, and the same story in node, browsers and workers. For a decoder
that is useless without its codecs, a build step nobody has to know about is
worth more than the bytes.

### Where it is not optimal

- **Two copies per block.** Unavoidable at this boundary — the codecs want a
  contiguous heap buffer — and the reason the block, not the record, is the
  unit.
- **The heap only grows** (see [Memory](#memory)), so peak tracks the largest
  single block ever decompressed.
- **The worker bundle carries its own copy** of the decoder and the wasm, so
  `src/wasm/cram-worker-source.js` is 395 KB (96 KB gzipped) in the published
  package — see [WORKERS.md](WORKERS.md#building-the-bundle). This used to say
  those bytes ship "whether or not the pool is enabled", which stopped being
  true when the bundle was code-split: `sliceWorkerPool.ts` imports it
  dynamically, from a function only called when a pool actually starts, so a
  bundler leaves it in a chunk nobody who never enables the pool loads. Measured
  with esbuild over `IndexedCramFile` + `CraiIndex`, that took an entry point
  from 534 KB to 268 KB.
- **No SIMD, no wasm threads**, which is a real ceiling on single-block
  throughput; the parallelism comes from slices instead (below).

## What it costs

|                             |                        |
| --------------------------- | ---------------------- |
| `src/wasm/htscodecs.js`     | 128 KB (55 KB gzipped) |
| wasm binary inside it       | 113 KB                 |
| instantiation               | ~5 ms, once            |
| wasm heap                   | 16 MB floor            |
| `src/xz-decompress/wasm.ts` | 16 KB, lzma only       |

The binary stays this small because we only link decoders — no compressor, and
none of the SIMD-specialized htscodecs variants.

**Only the lzma module is base64.** `src/xz-decompress/wasm.ts` really is a
`data:application/wasm;base64,` URI, and this file used to describe the
htscodecs bundle the same way. It is not: emscripten's `SINGLE_FILE=1` writes
the binary as a string of one character per byte, unpacked by the
`b[c] = ~f >> 8 & f` loop at the top of `htscodecs.js`. That is why 113 KB of
wasm fits in a 128 KB file, where base64 would have needed 151 KB of it — worth
knowing before anyone tries to "fix" the encoding or measures the wrong thing.

Instantiation waits for the first compressed block rather than happening at
import time, and the instance is then reused for the life of the process however
many CRAM files you open. Since that first instantiation is async, every decoder
entry point in `src/htscodecs-wasm.ts` is async too; once it's done, calls
resolve against an instance that already exists.

Each decode copies its input into the wasm heap and copies the output back out
to a JS `Uint8Array`. Those two copies are what you pay at the boundary, and
they're the reason this is worth doing per block and not per record.

## Memory

The heap starts at 16 MB and grows on demand, up to a 2 GB cap. A wasm heap can
only ever grow, since memory never goes back to the OS, so peak usage climbs to
the largest single block you decompress and stays there. Ordinary CRAM slices
never push it off the 16 MB floor.

Within the heap nothing piles up between calls: every allocation is freed before
the decode returns.

On a large query, the decoded records on the JS heap outweigh the wasm heap
anyway. `IndexedCramFile`'s `cacheSize` (default 1,000,000 records) is the knob
for that one, and bulk consumers can read the columnar `readFeatureArena` to
skip materializing per-feature objects — see
[MEMORY.md](MEMORY.md#columns-not-objects).

## Threading

Decoding is single-threaded scalar code, with no wasm threads and no SIMD, so
one block decode uses one core. Overlapping happens a level up instead: slices
are independent, and [WORKERS.md](WORKERS.md) is the pool that decodes them
concurrently, one wasm instance per worker. That also keeps `SharedArrayBuffer`
— and so cross-origin isolation — out of the requirements, since slices are
transferred rather than shared.

## Building

[CODEC_SUPPORT.md](CODEC_SUPPORT.md) has the update and rebuild scripts, and
`htscodecs-wasm/build.sh` has the emcc flags the numbers above come from.
