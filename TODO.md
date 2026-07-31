# TODO

Investigated, measured, not yet done. Numbers below were measured on this repo
at v8.7.0 — see the method note at the bottom before trusting or re-running
them.

## Cached slices redo their reference decoration on every query

`CramSlice.getRecords` serves records from `featureCache`, then unconditionally
re-runs the filter, recomputes the reference regions, **re-issues every
`fetchReferenceSequenceCallback` call**, and re-runs `addReferenceSequence` over
records that are already decorated. Five identical queries against a fully
cached file:

```
ONT       seqFetch calls per query: 1, 1, 1, 1, 1 | bases: 310089 ×5
Illumina  seqFetch calls per query: 3, 3, 3, 3, 3 | bases: 30280 ×5
```

`addReferenceSequence` is 9.0% of ONT decode self-time, and in jbrowse each of
those calls goes through `CramAdapter.seqFetch` to the sequence sub-adapter — so
every pan back over cached data re-reads reference sequence it already has. Fix
is to track the span the cached records are already decorated against and skip
when the new query is covered.

## `readBlock` reads the same offset twice

`readBlock` reads `cramBlockHeader.maxLength` at a position, then reads the full
block at the same position — the second read is a superset of the first. Per
cold decode: 2 of 8 filehandle reads on ONT, 6 of 22 on Illumina are redundant
(~25%), but only ~34–102 redundant _bytes_. Irrelevant locally; over HTTP it is
25% more range requests on the setup path. Measured at the CramFile→filehandle
boundary — check whether generic-filehandle2 already coalesces before changing.

## No AbortSignal on the record read path

`getRecordsForRange` accepts no `signal` — only `IndexOpts` (the `.crai`
download) does. So a cancelled query keeps downloading its slice data to
completion and then discards it. jbrowse-components wants this: its adapters
thread a stop-token-derived signal into `@gmod/bam`, `@gmod/tabix` and
`@gmod/bbi` already, and CRAM is the one indexed format left out.

### Why it is worth more than "index reads are short" suggests

The caller's byte-range layer coalesces contiguous 256 KiB chunks into one range
request, so a _small viewport over deep data_ becomes a _large_ single read.
Measured in jbrowse on the analogous BAM path (not CRAM — nobody has measured
CRAM): one 4 kb viewport over a 2000x BAM issues a single **6.5 MiB** range
read, and over a 4-hop pan burst throttled to 50 KiB/s, three cancelled
navigations abandoned ~6.5 MiB each — ~19.5 MiB that would otherwise transfer in
full and be thrown away. The same `RemoteFileWithRangeCache` sits under CRAM, so
expect the same order of magnitude.

### The trap — read this before starting

The read path is a stack of **self-clearing memoized promises**:
`getDefinition`, `getCompressionScheme`, `getHeader`,
`_getBlocksContentIdIndex`, then `SliceRecordCache`. Every one of them already
evicts on rejection, so a cancellation cannot _poison_ a cache —
`SliceRecordCache` documents exactly that hazard. That is not the problem.

The problem is that none of them has a **foreign-abort retry**. Thread a signal
in naively and a query that happens to share a memoized read with a cancelled
query inherits that cancellation as its own failure. It will succeed on a retry
(the entry was dropped), but the in-flight sharer fails for a reason that has
nothing to do with it.

### Shape

- **Thread the signal only into the bulk slice-data reads** reached from
  `_fetchRecords`. Do **not** thread it into `getDefinition` /
  `getCompressionScheme` / `getHeader` / `_getBlocksContentIdIndex`: those are
  small, one-time, and shared file-wide, so cancelling them on one query's
  behalf is wrong regardless of retries.
- **Handle the sharing at `CramSlice.getRecords`**, the one level that shares
  bulk reads between queries. Two proven patterns to pick from:
  - the retry `@gmod/bam` (>= 7.6.0) uses in `_cachedChunkFeatures`: remember
    the owning signal, and if the read you joined aborted while yours did not,
    start over.
  - the ref-counted abort `@gmod/abortable-promise-cache` gives `@gmod/tabix`
    and `@gmod/bbi` for free, where `AggregateAbortController` fires only once
    _every_ joined consumer has aborted. Cleaner, but CRAM's memoization is
    bespoke, so adopting it means reworking the cache rather than adding ten
    lines.

### Consumer

jbrowse's `CramAdapter.getFeatures` would wrap the read in
`withStopTokenSignal(stopToken, signal => ...)`, exactly as `BamAdapter` now
does. Nothing else changes on that side.

## Simplifications (no perf angle)

- `CramSlice._fetchRecords` is ~390 lines doing six unrelated jobs: MD5 check,
  external-block int/byte classification, ITF8 pre-decoding, per-data-series
  decoder binding, per-tag decoder binding, and the record loop. Everything up
  to `tagDescriptorsByTL` is a pure function of (compression scheme, blocks,
  cursors) and could build the `SliceDecodeContext` in its own module.
- The `bind()` closures in that function are a fourth copy of the
  External/ByteArrayStop/ByteArrayLength decode logic, bounds checks included. A
  `CramCodec.bindDecoder(coreDataBlock, blocksByContentId, cursors)` returning a
  specialised closure (defaulting to `() => this.decode(...)`) would let each
  codec own its fast path and drop the `instanceof` chain.
- The self-clearing async memoize block is copy-pasted seven times across
  `file.ts`, `container/index.ts` and `slice/index.ts`.
- `sectionParsers.ts` has ~40 sites of
  `const [v, newOffsetN] = parseItf8(buffer, offset); offset += newOffsetN`,
  with `newOffset1..8` numbered inconsistently against the fields they belong
  to. A small reader over `(buffer, offset)` with `.itf8()`/`.ltf8()`/`.u8()`/
  `.u32()` would roughly halve the file.

## Measured and _not_ worth doing

Recorded so they are not rediscovered:

- **`batchDecodeItf8` scratch sizing.** The `new Int32Array(buffer.length)`
  looks like a 4x over-allocation; measured utilisation is **97.5–100%** (ITF8
  values in these blocks are overwhelmingly single-byte) and the `.slice()` copy
  path fires on 0.15 MB of 14.70 MB.
- **A short-buffer fast path in `decodeUtf8`.** Node 24's `TextDecoder` matches
  or beats `String.fromCharCode.apply` at every length tested (73–114 ns/call vs
  62–147), and is 2x faster at length 12.
- **A positional `CramRecord` constructor.** `decodeRecord` builds a 19-key
  object literal that `new CramRecord(...)` immediately destructures and drops,
  one per record — so on the per-record-and-GC-bound short-read path it looks
  like free throughput. Having `decodeRecord` return the `CramRecord` directly,
  through a 19-argument positional constructor, does remove the allocation, and
  the output is byte-identical (sha256 over `toJSON()` + `getCigarString()` +
  `getPairOrientation()` for all 92,582 records in `test/data`). It buys nothing
  worth having: five alternating processes per tree, median-of-medians, gave
  129.6 → 128.5 ms on SRR396637 and 56.2 → 56.0 ms on SRR396636, both inside the
  ±1% cold-decode noise floor. GC time does drop consistently (107 → 94 ms on
  SRR396637, ~12%), confirming the allocation really is gone, but GC is only ~8%
  of that decode so it never reaches 1% end-to-end. Against that: nineteen
  unlabelled positional parameters, sixteen of them `number` or
  `number | undefined`, where any transposition still typechecks — and it is a
  breaking change to a public constructor. If the constructor is revisited, do
  it for the _type_ wart instead: its parameter is
  `ReturnType<typeof decodeRecord>`, so every key is required and building a
  record by hand means spelling out seven explicit `undefined`s (see
  `test/pairOrientation.test.ts`). A named `CramRecordArgs` interface with the
  optional fields marked optional fixes that at no runtime cost.
- **`CramRecord` hidden-class stability.** The conditional constructor
  assignments look like they would split the hidden class; measured **1 shape**
  across all records, because `target: es2022` implies
  `useDefineForClassFields`. Do not "fix" this, and note that lowering the
  compile target would silently undo it.
- **Coalescing consecutive single-base `i` insertions.** The note that used to
  live here claimed 34,387 of the ONT fixture's 213,602 features (16%) were
  single-base insertions "that both jbrowse consumers immediately re-coalesce
  into runs". They are single-base insertions, but they are _isolated_: counting
  adjacent `(i, i)` slot pairs — which is exactly the pair a consumer merges,
  since two adjacent `i` features share a reference position if and only if
  their read positions are adjacent — gives **0 runs on ONT, 0 on SRR396636, 0
  on SRR396637**. Coalescing at decode time bought nothing on all three, in
  exchange for a per-feature branch in the decode loop and a change to a public
  output shape (it altered exactly one of the 189 snapshots, the grc37-1
  Illumina one). htslib does not merge the features either — its `case 'i'`
  accumulates into the _CIGAR_ via `cig_len++` while keeping one decode step per
  feature (`cram/cram_decode.c`). Leave the merging in the consumer walks.
- **Read-feature polymorphism as a consumer cost.** Forcing true monomorphism
  made jbrowse's two walks no faster — noise in both directions. Moving `ref`/
  `sub` into the arena's byte columns was worth doing for its _memory_, not for
  call-site shape.
- **A `Uint32Array` NUMERIC_CIGAR for every read.** In jbrowse's
  `readFeaturesToNumericCIGAR` it is 8.7% faster and half the retained bytes on
  ONT (median 4391 ops/read), but **147% slower and 2.4x the memory** on short
  reads (median 1 op/read), where ~96 bytes of fixed typed-array overhead lands
  on a one-element payload. Same shape of trap as the per-record arena. That
  walk now switches per read at 64 ops, matching the ~50–100 crossover bam-js
  measured in its own `src/record.ts`.

## Packing the arena's columns — measured, and now a breaking change

On the ONT slice `payloadOffsets` is 854 KB (11.5% of the 7.42 MB the records
retain) and `refCodes`/`subCodes` together are 427 KB (5.7%). Offsets are
monotonic, so a per-record base offset would collapse them; and an X feature's
`num` only holds a 0–3 substitution-matrix index, so `ref`/`sub` would fit in
its spare bits.

Neither is worth doing now. The columns are public API — jbrowse's
`readFeaturesToMismatches` reads `refCodes`/`subCodes`/`num` directly, because
that walk is on its render path and emits jbrowse's own mismatch vocabulary, so
it cannot move in here. Packing them is therefore a breaking change for a few
percent. Privatising the layout would mean cram-js owning that walk too, which
would drag `@jbrowse/cigar-utils`' render types into a file parser.

## Method note

Retained-heap figures come from decoding into a held variable in a **fresh
process per variant**, with a forced GC either side and no warm-up decode (a
discarded `await` at module top level stays reachable and lands in the baseline,
which silently collapses the measured delta to ~0). Noise floor on a
base-vs-base control was ±0.2% for heap, ±1% for cold decode, ±8% for warm
re-query.

**No wall-clock claim here is trustworthy** — the machine was loaded when these
were taken, and the timing noise floor is wider than most of the effects.
Re-measure timings on a quiet machine before quoting any.

Two traps worth knowing, both found the hard way while landing the columnar read
features:

- **`heapUsed` does not see typed arrays.** V8 allocates ArrayBuffer backing
  stores outside the JS heap, so a struct-of-arrays layout looks nearly free if
  you only read `process.memoryUsage().heapUsed` — the first ONT measurement
  came out at 0.93 MB against an 18.07 MB baseline. Add `arrayBuffers`.
  `scripts/measure-heap.ts` reports both columns and their sum.
- **Do not A/B two source trees in one process.** Importing a baseline and a
  candidate side by side and interleaving them round by round made the columnar
  decode look 7–11% _slower_ on ONT, consistently across five runs — consistent
  enough to look real rather than noisy. It was an artifact of the two variants
  sharing a heap and a GC history: one-tree-per-process runs and a separate CPU
  profile of each tree both showed it _faster_ (GC self-time 143 ms → 24 ms).
  Alternate processes, not imports.
