# Decoding slices on a worker pool

A CRAM query decodes one or more slices, and slices are independent. Since 12.1
that decode happens on a shared pool of workers where the host has them, which
is on by default and needs no configuration:

```js
// the pool is used automatically
const records = await indexedFile.getRecordsForRange(0, 1000, 2000)
```

Turn it off with `useSliceWorkerPool: false`, and size it with `numSliceWorkers`
— see [the constructor options](../README.md).

## Why the whole slice, and not just decompression

`@gmod/bgzf-filehandle` parallelises inflate, because for BAM that is
substantially the whole cost of a read. Doing the same here was measured and
rejected. Block decompression is only **24–35%** of a cold CRAM query:

| fixture                        | query  | decompression |
| ------------------------------ | ------ | ------------- |
| SRR396637 (54,695 short reads) | 483 ms | 24%           |
| SRR396636 (23,051 short reads) | 137 ms | 25%           |
| HG002 ONT (37 long reads)      | 76 ms  | 35%           |

Amdahl caps a decompression-only pool at ~1.33x, and the real figure is lower
still because the heavy blocks within one slice are few — on the ONT slice a
single 19.1 ms block is 74% of that slice's decompression, so there is barely
anything to spread. Modelled end to end it came out at **1.05–1.46x**.

So the unit of work is the whole slice: decompression, the record decode, and
mate association. That is ~95% of a query rather than a quarter of it.

## The width is there where it matters

Slice-level parallelism only helps if a query touches several slices. At
jb2bench's own 19 kb region:

| fixture         | records | slices |
| --------------- | ------- | ------ |
| 20x.shortread   | 3,081   | 2      |
| 200x.shortread  | 31,133  | 4      |
| 1000x.shortread | 153,677 | **16** |
| 20x.longread    | 36      | 1      |
| 200x.longread   | 335     | 6      |
| 1000x.longread  | 1,683   | **22** |

Deep files — the slow ones — have plenty. Shallow files fall to one or two, and
they are already fast. Note that even at one slice the decode is off the main
thread, which is the part a UI notices; throughput is the secondary benefit.

## What crosses the boundary

Neither direction can send the obvious thing.

**Into the worker**: not a `CramFile` — it holds a filehandle and a
`fetchReferenceSequence` callback. So `CramSlice.buildDecodeRequest` describes a
slice as bytes and numbers (`SliceDecodeRequest`), and `decodeSliceFromBytes`
decodes it with nothing else in reach. The compression scheme travels as the
container's decompressed compression-header bytes rather than as a parsed
scheme, because the parsed form holds codec instances; the worker parses it once
per container and caches it, since a container holds several slices.

**Out of the worker**: not `CramRecord[]` — a class instance loses its prototype
and its getters do not serialise. Cloning the records as plain objects measured
**1011 ms against a 392 ms decode**, which would have made the whole exercise
pointless. `cramFile/sliceTransfer.ts` is the wire form instead: the
read-feature arena, tag column and quality column are already typed arrays and
transfer at zero copy, and the per-record scalars pack into one `Int32Array`.
Strings stay strings — 15 ms for 153,677 of them, against 112 ms to encode the
same set into bytes.

**The reference stays behind.** `fetchReferenceSequence` is caller-supplied, so
`_fetchRecords` applies it on the main thread after deserialising, by the same
code that decorates an in-process decode. Records arrive from the worker with no
`_refRegion`, which is why `getReadBases()` on a raw transfer payload returns
undefined — see the note in `sliceTransfer.ts`.

## Falling back

The pool is an optimisation that can always be declined, and
`_fetchRecordsInWorker` returns undefined rather than throwing for every reason
short of a malformed file:

- no `Worker` or Blob URL — node, vitest, or a restricted host
- a slice of unknown size, i.e. non-indexed access through `CramFile` directly,
  where blocks are read one at a time and there is no single byte range to send
- a pool that failed to start, which warns once per file

A **decode error** does propagate: a malformed CRAM must fail rather than
quietly re-decode on the main thread and fail there. Error classes are carried
across by name and rebuilt, so `CramMalformedError` still arrives as one —
consumers catch by class.

## Building the bundle

The worker is inlined as a string so the pool can launch it from a Blob URL with
no consumer wiring, matching how the wasm is handled (see [WASM.md](WASM.md)):

```
src/worker/sliceWorkerEntry.ts        the message loop, and nothing else
  -> tsc            esm/worker/sliceWorkerEntry.js
  -> webpack        src/wasm/cram-worker-inlined.js     (webpack.worker.config.js)
  -> inline-worker  src/wasm/cram-worker-source.js      (~394 KB, tracked)
```

`pnpm build:worker` does the last two steps. It is wired into `pnpm build`, and
**`build:esm` runs on both sides of it** — once to give webpack something to
bundle, once more so the regenerated string module reaches `esm/` and `dist/`.

Unlike `bgzf-filehandle`, whose equivalent artifact no script in that repo
produces, this one is built by the build. That matters because `preversion` runs
`pnpm build`: a generated artifact nothing regenerates is one `npm version` can
commit unreviewed part-way through a release. It rebuilds byte-for-byte, so
`git status` stays clean — check it the same way as the wasm bundle.

The size is the cost of the inline approach: the worker carries the decoder
_and_ the base64 wasm, so it is ~394 KB that every consumer downloads whether or
not they enable the pool. That was a deliberate trade for zero consumer wiring.
