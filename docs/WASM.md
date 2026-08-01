# WebAssembly decoding

Every block codec except lzma is [samtools/htscodecs](https://github.com/samtools/htscodecs)
compiled to a single WebAssembly module. gzip goes through libdeflate, bzip2
through the emscripten bzip2 port, and lzma/xz is the one decoder still written
in JS. The module is inlined in the bundle and loads itself, so there is nothing
to set up.

## Why

CRAM 3.1 was effectively unreadable in JS for years, and the reason was
fqzcomp, tok3 and the adaptive arithmetic coder. Between them that's thousands
of lines of context-modelling C, and porting it by hand means signing up to keep
a second copy correct forever. Compiling the real thing got all of it in one
step, including the rANS 4x16 and tok3 sub-variants that tools do actually emit.

Running the same C samtools runs also settles the question of whether a block
decoded correctly: it decodes to the same bytes `samtools view` gets. When
htscodecs fixes something upstream, picking it up is a script rerun.

Speed comes along with that. Quality scores and read names are where a CRAM
read spends most of its decoding time, and those are now compiled code rather
than an interpreted inner loop. gzip gets libdeflate, which is quick even by
native standards.

And because the wasm is inlined, it behaves like any other JS dependency. No
second request, no static asset to copy into your build, no MIME type or CSP
rules, same story in node, browsers and workers.

## What it costs

| | |
| --- | --- |
| `src/wasm/htscodecs.js` | 128 KB (55 KB gzipped) |
| wasm binary inside it | 113 KB |
| instantiation | ~5 ms, once |
| wasm heap | 16 MB floor |

The binary stays this small because we only link decoders — no compressor, and
none of the SIMD-specialized htscodecs variants.

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
anyway. `IndexedCramFile`'s `cacheSize` (default 20000 records) is the knob for
that one, and bulk consumers can read the columnar `readFeatureArena` to skip
materializing per-feature objects — see
[the README](../README.md#reading-differences-from-the-reference).

## Threading

Decoding is single-threaded scalar code, with no wasm threads and no SIMD, so
one block decode uses one core. Run whole queries in workers if you want them
overlapping.

## Building

[CODEC_SUPPORT.md](CODEC_SUPPORT.md) has the update and rebuild scripts, and
`htscodecs-wasm/build.sh` has the emcc flags the numbers above come from.
</content>
</invoke>
