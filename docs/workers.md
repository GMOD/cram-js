# Decoding slices on a worker pool

A CRAM query decodes one or more slices, and slices are independent. Since 12.1
the library decodes them on a shared pool of workers where the host has them.
The pool is on by default and needs no configuration:

```js
// decodes on the pool by default
const records = await indexedFile.getRecordsForRange('chr1', 1000, 2000)
```

Turn it off with `useSliceWorkerPool: false`, and size it with
`numSliceWorkers`; see [the constructor options](api.md#indexedcramfile).
`IndexedCramFile` and `CramFile` both take these options. Through 13.1.0 only
`CramFile` took them, so in practice the options were unreachable.

One pool serves a whole **JS context**, so a host that runs several contexts
gets one pool in each, and should size them with `numSliceWorkers` accordingly.
jbrowse, for example, spreads tracks over up to five RPC workers.
`@gmod/bgzf-filehandle` implements one pool shared across contexts, which would
bound the total by construction.
[ADR 0009](adr/0009-one-pool-per-context-sized-for-the-host.md) explains why
cram-js uses a pool per context instead, with the measurements for both designs.

## Why the whole slice, and not just decompression

`@gmod/bgzf-filehandle` parallelizes inflate, because for BAM that is
substantially the whole cost of a read. We measured the same approach here and
rejected it. Block decompression is only **24–35%** of a cold CRAM query:

| fixture                        | query  | decompression |
| ------------------------------ | ------ | ------------- |
| SRR396637 (54,695 short reads) | 483 ms | 24%           |
| SRR396636 (23,051 short reads) | 137 ms | 25%           |
| HG002 ONT (37 long reads)      | 76 ms  | 35%           |

Amdahl's law caps a decompression-only pool at ~1.33x. The real figure is lower
still, because each slice has few heavy blocks. On the ONT slice a single 19.1
ms block is 74% of that slice's decompression, which leaves little work to
spread across workers. Our end-to-end model of a decompression-only pool gave
**1.05–1.46x**, against the 2.0–2.8x measured below for the whole slice.

The unit of work is therefore the whole slice: decompression, the record decode,
and mate association — about 95% of a query rather than a quarter of it.

## Measurements

The table compares four worker threads against in-process decoding, timing the
decode only, over jb2bench's 19 kb region. We ran it with `node:worker_threads`
rather than in a browser, so the numbers cover the decode and the transfer but
not a real browser `Worker`:

| fixture         | slices | in-process | pooled |           |
| --------------- | ------ | ---------- | ------ | --------- |
| 1000x.longread  | 22     | 1345 ms    | 484 ms | **2.78x** |
| 200x.longread   | 6      | 348 ms     | 137 ms | **2.54x** |
| 1000x.shortread | 16     | 323 ms     | 158 ms | **2.04x** |
| 200x.shortread  | 4      | 69 ms      | 51 ms  | 1.35x     |

The speedup falls short of 4x for two reasons. First, slices are uneven, and a
query waits for its largest. Second, when we took these numbers, the host
rebuilt one record object per record from the payload, serially. The host no
longer rebuilds them: a slice arrives as columns, each record is a view onto
them, and the slice is usable as soon as it arrives (ADR 0012).

### In a browser, nested inside another worker

The node table above, the first one we took, leaves out the configuration that
consumers ship. jbrowse runs `@gmod/cram` inside its own RPC worker, so this
pool is a **nested** worker: a `Worker` constructed from a Blob URL from inside
a `Worker`. The table below measures that case in headless Chrome on 16 cores,
over the same 19 kb region with the byte ranges warm, so it compares the decode
and not the fetch. The variants ran interleaved, and each figure is the fastest
of 5 reps x 5 rounds:

| fixture         | slices | in-process | pooled |           |
| --------------- | ------ | ---------- | ------ | --------- |
| 1000x.longread  | 22     | 2258 ms    | 629 ms | **3.59x** |
| 200x.longread   | 6      | 552 ms     | 239 ms | **2.31x** |
| 1000x.shortread | 16     | 564 ms     | 256 ms | **2.21x** |
| 200x.shortread  | 4      | 179 ms     | 85 ms  | **2.10x** |
| 20x.shortread   | 2      | 131 ms     | 67 ms  | **1.95x** |
| 20x.longread    | 1      | 82 ms      | 87 ms  | 0.93x     |

Nested workers and Blob URLs both work, and the nested pool is faster on every
row with more than one slice. The single-slice row is at parity, which agrees
with the 0.96x that the slice-count sweep below found under node.

**Measure this interleaved, not as two blocks.** Running all the in-process
rounds and then all the pooled ones put 200x.longread at 0.74x, and a repeat of
that same arrangement, with identical code, put it at 2.26x. The machine's speed
changed between the two blocks, and that change moved the ratio. Alternating the
variants exposes both to the same changes. This is the third benchmark harness
in this repo's history to produce a confident number that was not real;
[ADR 0006](adr/0006-cigar-as-a-callback-walk.md) and
[ADR 0008](adr/0008-emit-into-the-consumers-callback.md#evidence) describe the
other two. The slice-count threshold below was rejected for the same reason.

**There is no slice-count threshold, and we measured for one and rejected it.**
An early run put a 2-slice query at 0.72x, so we wrote a threshold to skip the
pool below four slices; the 0.72x then failed to reproduce. A sweep of slice
count on the same corpus, with a median of 9 rather than 3, gives a curve that
rises with slice count except at 4 slices on 1000x.shortread, where it dips from
1.69x to 1.58x:

| slices          | 1     | 2     | 3     | 4     |
| --------------- | ----- | ----- | ----- | ----- |
| 20x.shortread   | 0.96x | 1.16x | 1.49x | 1.72x |
| 1000x.shortread | 1.21x | 1.34x | 1.69x | 1.58x |

The pool is at parity at one slice and faster from two slices up. A median of 3
on a 40 ms workload is too noisy to count as a measurement, and this page
records it because the threshold nearly shipped on the strength of it. A
single-slice query never happens in isolation, though. The user pans, so the
pool stays warm, and the queries after the first matter more than a cold one.

## Slice counts

Slice-level parallelism helps only when a query touches several slices. The
table lists the slices each fixture has in jb2bench's 19 kb region:

| fixture         | records | slices |
| --------------- | ------- | ------ |
| 20x.shortread   | 3,081   | 2      |
| 200x.shortread  | 31,133  | 4      |
| 1000x.shortread | 153,677 | **16** |
| 20x.longread    | 36      | 1      |
| 200x.longread   | 335     | 6      |
| 1000x.longread  | 1,683   | **22** |

The deep files, which are the slow ones, have many slices. The shallow files
have one or two, where the measurements above put the pool at parity to 1.16x.
Even at one slice the pool moves the decode off the main thread, which is the
part a UI notices; throughput is the secondary benefit.

### The speedup grows with the region, up to a point

19 kb is jb2bench's window, not a limit. The table below sweeps the region width
on the same fixtures under the same conditions: in the browser, with warm bytes,
interleaved:

| fixture         | region     | records   | in-process | pooled  |           |
| --------------- | ---------- | --------- | ---------- | ------- | --------- |
| 1000x.shortread | 19 kb      | 153,677   | 413 ms     | 252 ms  | 1.64x     |
| 1000x.shortread | **100 kb** | 802,801   | 1822 ms    | 676 ms  | **2.69x** |
| 1000x.shortread | 250 kb     | 2,000,000 | 4322 ms    | 2317 ms | 1.87x     |
| 1000x.longread  | **100 kb** | 3,642     | 4094 ms    | 1204 ms | **3.40x** |

The speedup peaks rather than climbing: at 250 kb it falls back to 1.87x. The
host deserializes the payload serially, so past some width that serial share
grows faster than the parallel one. That is the Amdahl ceiling noted above,
visible here as a turning point rather than only as a cap.

**A consumer that gates its queries by size never reaches the peak.** jbrowse
caps a pileup on estimated fetch bytes (5 MB for CRAM) and on screen density.
100 kb of `1000x.shortread.cram` is about 11.9 MB, so jbrowse refuses it
outright and shows a force-load banner instead. For that fixture the cap falls
near 40 kb, so a jbrowse pileup always stays in the 19-40 kb band, at the
_shallow_ end of this table. The size gate makes that permanent rather than
incidental, and it explains most of why the end-to-end speedup measured in
jbrowse is around 1.1x while the decode alone is 2.2x.

The pool is therefore worth much more to a consumer that decodes a large region
in one go, such as a whole-contig scan, an export, an analysis script or a
force-load, than to an interactive pileup that a consumer deliberately keeps
small.

## What crosses the boundary

**Into the worker.** A `CramFile` holds a filehandle and a
`fetchReferenceSequence` callback, so the host cannot send one. Instead
`CramSlice.buildDecodeRequest` describes a slice as bytes and numbers
(`SliceDecodeRequest`), and `decodeSliceFromBytes` decodes it from those alone.
The host sends the compression scheme as the container's decompressed
compression-header bytes rather than as a parsed scheme, because the parsed form
holds codec instances. The worker parses the header once per container and
caches it, since a container holds several slices. The cache key is the
container's file position, but one pool serves every CRAM in the context, so a
cache hit also has to match the header bytes. Otherwise two files whose first
containers sit at the same position would swap codecs. See `getScheme`.

**Out of the worker.** The worker sends back the decoded slice itself
(`cramFile/decodedSlice.ts`). The decode writes only columns: the read-feature
arena, the tag column and the quality column, plus one `Int32Array` of
per-record scalars. The slice therefore transfers at zero copy, and a
`CramRecord` on the host is a view onto it.

The transfer cost is also why records are views rather than objects. Cloning
per-record objects took **1011 ms against a 392 ms decode**. The earlier wire
form rebuilt one object per record on the host, serially, at 0.5 µs per record:
a quarter of an in-process decode on a 54,695-record file, and the term that
capped the pool's speedup (ADR 0012). The worker sends strings as strings, which
takes 15 ms for 153,677 of them, against 112 ms to encode the same set into
bytes.

**The reference stays on the main thread.** The caller supplies
`fetchReferenceSequence`, so `CramSlice` calls it on the main thread after the
slice arrives, and applies the reference with the same code that decorates an
in-process decode. A slice from the worker has no `refRegions`, which is why
`getReadBases()` on a raw transfer returns undefined.

## Falling back

Every caller can fall back to decoding in-process, so acquiring the pool
resolves undefined rather than throwing, for every failure short of a malformed
file. `CramSlice` then runs the same `decodeSliceFromBytes` in-process in these
cases:

- no `Worker` or Blob URL, as in node, vitest or a restricted host
- a pool that failed to start, which the library warns about once per file. The
  cases are a worker that reports an error, a worker whose wasm will not
  instantiate, and a worker that never answers the init handshake. The library
  detects the last case with a 30 s timeout, because that worker reports
  nothing. A CSP that refuses `blob:` in worker-src is the usual cause. All
  three have to reject rather than wait, because the decode awaits the pool
  first, and a hang there would hang every query against the file.
- a worker that dies while decoding a slice, or a pool destroyed while a slice
  is in flight. The slice then decodes on the main thread, because losing a
  worker is no evidence of a fault in the file.

A **decode error** does propagate: re-decoding a malformed CRAM on the main
thread would only fail there too. Error classes cross the boundary by name and
the receiving side rebuilds them, so `CramMalformedError` still arrives as one,
and the package entry point exports the classes so a consumer can refer to them.

## Building the bundle

The package inlines the worker as a string, so the pool can launch it from a
Blob URL with no consumer wiring, in the same way the package inlines the wasm
(see [wasm.md](wasm.md)):

```
src/worker/sliceWorkerEntry.ts        the message loop, and nothing else
  -> tsc            esm/worker/sliceWorkerEntry.js
  -> webpack        build/worker/cram-worker-inlined.js  (webpack.worker.config.js)
  -> inline-worker  src/wasm/cram-worker-source.js       (~400 KB, tracked)
```

Webpack writes the intermediate bundle to the gitignored `build/`, **not** to
`src/wasm/`, where it used to go. `allowJs` makes everything under `src/` a tsc
input, so when the bundle sat in `src/wasm/`, tsc compiled it into `esm/` and
`dist/` too, and we published it three times over with two sourcemaps: about a
megabyte of a file that no module imports. Git tracks only the string module,
for the reason [wasm.md](wasm.md) gives for the wasm bundle.

Two settings follow from the intermediate never reaching the package:

- Terser runs with `extractComments: false`, so license banners stay **inside**
  the bundle. With extraction on, the notice would stay in `build/` while the
  code it covers shipped to every consumer, under a banner naming a file that
  does not exist.
- `inline-worker.sh` writes `/** @type {string} */` above the generated const.
  Without it tsc infers the type of a 400,000-character bundle as a string
  literal type and writes the whole thing out again as a 440 KB `.d.ts`, in both
  output dirs, for every consumer's tsc to parse. With the annotation, the
  `.d.ts` is 87 bytes.

`pnpm build:worker` does the last two steps. `pnpm build` calls it, and
**`build:esm` runs on both sides of it** — once to give webpack something to
bundle, once more so the regenerated string module reaches `esm/` and `dist/`.

`pnpm build` produces the string module, which matters because `preversion` runs
`pnpm build`. A generated artifact that no script regenerates is one that
`npm version` can commit unreviewed partway through a release. The module
rebuilds byte-for-byte, and `pnpm check:wasm` checks it along with the wasm
bundle.

`bgzf-filehandle` regenerates its equivalent artifact the same way. Its root
`build:wasm` delegates to the `bgzf-wasm-build` workspace package in `crate/`,
whose `build` script ends in `build:worker-bundle`, which runs webpack and then
`inline-worker.sh` (checked 2026-08-12).

The worker bundle contains the decoder _and_ the wasm, so inlining it costs a
400 KB string module (96 KB gzipped). We accepted that size so that consumers
need no wiring.

`sliceWorkerPool.ts` loads the bundle through a dynamic `import()` inside
`getWorkerBlobUrl`, which runs only when a pool starts, so a bundler puts the
400 KB in a separate chunk that not every consumer downloads. In an esbuild
bundle of `IndexedCramFile` + `CraiIndex`, the entry point is 268 KB with the
split and 534 KB without it. A consumer who never enables the pool, or who runs
under node where the pool cannot start, loads none of the chunk. (The npm
tarball contains the bytes either way, as `src/`, `esm/` and `dist/` copies; the
split changes only what reaches a browser.)
