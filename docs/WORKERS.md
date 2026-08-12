# Decoding slices on a worker pool

A CRAM query decodes one or more slices, and slices are independent. Since 12.1
that decode happens on a shared pool of workers where the host has them, which
is on by default and needs no configuration:

```js
// the pool is used automatically
const records = await indexedFile.getRecordsForRange(0, 1000, 2000)
```

Turn it off with `useSliceWorkerPool: false`, and size it with `numSliceWorkers`
— see [the constructor options](API.md#indexedcramfile). Both go to
`IndexedCramFile` as well as to `CramFile`; through 13.1.0 they reached only the
latter, which is to say they were unreachable.

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
anything to spread. Modelled end to end it came out at **1.05–1.46x**, against
the 2.0–2.8x measured below for the whole slice.

So the unit of work is the whole slice: decompression, the record decode, and
mate association. That is ~95% of a query rather than a quarter of it.

## Measured

Four threads against in-process, decode only, jb2bench's 19 kb region. Taken
with `node:worker_threads` rather than in a browser, so the numbers cover the
decode and the transfer but not a real browser `Worker`:

| fixture         | slices | in-process | pooled |           |
| --------------- | ------ | ---------- | ------ | --------- |
| 1000x.longread  | 22     | 1345 ms    | 484 ms | **2.78x** |
| 200x.longread   | 6      | 348 ms     | 137 ms | **2.54x** |
| 1000x.shortread | 16     | 323 ms     | 158 ms | **2.04x** |
| 200x.shortread  | 4      | 69 ms      | 51 ms  | 1.35x     |

Short of 4x because deserialising the payload happens on the host and is serial,
and because slices are uneven — a query waits for its largest.

### In a browser, nested inside another worker

The table above was the only one for a while, and it left the configuration
consumers actually ship unmeasured. jbrowse runs `@gmod/cram` inside its own RPC
worker, so this pool is a **nested** worker: a `Worker` constructed from a Blob
URL from inside a `Worker`. Headless Chrome, 16 cores, same 19 kb region, the
byte ranges warm (so the comparison is the decode, not the fetch), interleaved,
fastest of 5 reps x 5 rounds:

| fixture         | slices | in-process | pooled |           |
| --------------- | ------ | ---------- | ------ | --------- |
| 1000x.longread  | 22     | 2258 ms    | 629 ms | **3.59x** |
| 200x.longread   | 6      | 552 ms     | 239 ms | **2.31x** |
| 1000x.shortread | 16     | 564 ms     | 256 ms | **2.21x** |
| 200x.shortread  | 4      | 179 ms     | 85 ms  | **2.10x** |
| 20x.shortread   | 2      | 131 ms     | 67 ms  | **1.95x** |
| 20x.longread    | 1      | 82 ms      | 87 ms  | 0.93x     |

So the nested case works and pays — nested workers and Blob URLs are both fine —
and the single-slice row is parity, agreeing with the 0.96x the slice-count
sweep below found under node.

**Measure this interleaved, not as two blocks.** Running all the in-process
rounds and then all the pooled ones put 200x.longread at 0.74x, and a repeat of
that same arrangement at 2.26x. Nothing about the code changed between them; the
machine drifted between the two blocks and the drift landed in the ratio.
Alternating the variants puts it in both instead. This is the third harness trap
in this repo's history to produce a confident number that was not real — see
[ADR 0006](adr/0006-cigar-as-a-callback-walk.md) and
[ADR 0008](adr/0008-emit-into-the-consumers-callback.md#evidence) for the other
two — and it is the same lesson as the rejected threshold below, which was very
nearly shipped on the strength of a 0.72x that came from the same kind of run.

**There is no slice-count threshold, and one was measured for and rejected.** An
early run put a 2-slice query at 0.72x and a threshold was written to skip the
pool below four slices; the 0.72x then failed to reproduce. Sweeping slice count
on the same corpus with a median of 9 rather than 3 gives a clean monotonic
curve:

| slices          | 1     | 2     | 3     | 4     |
| --------------- | ----- | ----- | ----- | ----- |
| 20x.shortread   | 0.96x | 1.16x | 1.49x | 1.72x |
| 1000x.shortread | 1.21x | 1.34x | 1.69x | 1.58x |

Parity at one slice, a win from two up. The lesson is the ordinary one — a
median of 3 on a 40 ms workload is not a measurement — but it is recorded
because the threshold was nearly shipped on the strength of it. Note also that a
single-slice query does not occur in isolation: a viewport is panned, so the
pool is warm and the marginal query is what matters.

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

Deep files — the slow ones — have plenty. Shallow files fall to one or two,
where the measurements above put the pool at parity to 1.16x. Note that even at
one slice the decode is off the main thread, which is the part a UI notices;
throughput is the secondary benefit.

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
  -> webpack        build/worker/cram-worker-inlined.js  (webpack.worker.config.js)
  -> inline-worker  src/wasm/cram-worker-source.js       (~405 KB, tracked)
```

The intermediate goes to `build/`, which is gitignored, and **not** to
`src/wasm/` where it used to. `allowJs` makes everything under `src/` a tsc
input, so from there it was compiled into `esm/` and `dist/` too and published
three times over with two sourcemaps — about a megabyte of a file nothing
imports. Only the string module is real, and that one is tracked, for the reason
[WASM.md](WASM.md) gives for the wasm bundle.

Two things follow from the intermediate not being a published file:

- Terser is configured with `extractComments: false` so license banners stay
  **inside** the bundle. Extracted, the notice would sit in `build/` while the
  code it covers travelled on into every consumer under a banner naming a file
  that does not exist.
- `inline-worker.sh` writes `/** @type {string} */` above the generated const.
  Without it tsc infers the type of a 400,000-character bundle as a string
  literal type and writes the whole thing out again as a 440 KB `.d.ts`, in both
  output dirs, for every consumer's tsc to parse. Annotated, it is 87 bytes.

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
