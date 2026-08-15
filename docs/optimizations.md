# Optimizations

Why the query path looks the way it does. The path itself is drawn in
[dataflow.dot](dataflow.dot) ([rendered](dataflow.svg)).

CRAM spends its time somewhere different from the BGZF formats. Block
decompression is only **24–35%** of a cold query, so a query is dominated by the
**record decode** and by what the decoded records **retain** — a slice is
decoded whole and then cached whole. Nearly everything below is one of two
moves: do per-slice work once per slice rather than once per record, and refuse
to pay a fixed per-object cost on a 100 bp read.

Each item names the measurement that settled it. Where a whole decision hangs on
it there is an [ADR](adr/);
[ADR 0007](adr/0007-optimizations-measured-and-rejected.md) is the list of
things that looked like wins and were not.

## Reading the index

### Parsed once, shared across callers

The `.crai` is a whole-file read, inflated and parsed on the first query and
memoized for the life of the object. It is the one read in `CraiIndex` that
several queries share, so a caller that joined someone else's parse and saw it
fail because _that_ caller aborted starts over rather than inheriting the
failure — once, then propagates.

### The overlap scan is bounded at both ends

Entries are sorted by start, so `getEntriesForRange` binary-searches the lower
bound at `queryStart - maxSpan` — the longest span on that reference, computed
at parse time — and stops the forward scan at `queryEnd` rather than running to
the end of the chromosome.

It used to filter the whole reference's entry list on every call. A whole-genome
`.crai` is hundreds of thousands of slices, and `viewAsPairs` calls this once
per unmated read, so a query returning n reads did O(n × slices) work to find a
handful of slices.

### Digits are accumulated, not built into strings

`parseIndex` walks the decompressed text byte by byte and accumulates each field
numerically. The `parseInt` of a built-up substring dominated index load on the
whole-genome files this is really sized for.

## Choosing and fetching slices

### Containers are shared across the slices of one query

A CRAM packs several slices per container, so without this every slice re-read
its container header and re-parsed its compression header block: on `ce#1000`,
149 slices over ~30 containers meant **456 of 1001** filehandle reads were exact
duplicates of another read in the same query.

The map is scoped to one query on purpose, and has to stay that way. A
container's memos are threaded with the caller's `AbortSignal` on a
first-caller-wins basis, which is sound only while every caller of one memo is
the same query — a file-level container cache needs the foreign-abort handling
the record cache and `CraiIndex` have
([ADR 0003](adr/0003-abortsignal-on-the-read-path.md), and [TODO.md](../TODO.md)
for the part still open).

### The decoded-slice cache is sized above one query

`featureCache` holds decoded records, keyed by slice position and by the decode
options that would change what a slice decodes to. It is bounded by **record
count** — a decoded record has no cheap size, and slices hold anywhere from a
handful of records to tens of thousands — and the default is 1,000,000 because
the number has to clear one query's working set. Below that it does not cache
less, it caches _nothing_: each slice is evicted before the next pan can reuse
it while the memory is retained anyway. A 50 kb window on 200x short-read data
is 90,000 records, and the old 20,000 default was 4.5x below it
([ADR 0004](adr/0004-size-the-slice-cache-above-one-query.md)).

Eviction is plain LRU, so the bound is honored. It used to be a `'batch'` policy
that spared everything an in-flight query touched — measured holding 420,000
records against a stated 20,000 — which rescues an undersized budget by
exceeding it. Above the working set the two measure identically, so it was
dropped ([ADR 0005](adr/0005-drop-the-batch-eviction-policy.md)).
`cacheIdleTimeoutMs` is what lowers the cache while nothing is happening, and
`cacheBudget` lets several files share one ceiling instead of each holding its
own. [MEMORY.md](MEMORY.md#the-slice-cache) has both.

What is cached is the whole decoded slice, already decorated with its reference
sequence — `applyReferenceSequence` runs once per slice inside the cached decode
rather than once per query over the filtered subset — and the filter is applied
to the cached records afterwards. So a pan that re-asks for a different window
of the same slice pays nothing but the filter.

### Mate slices are deduplicated, and decoded under the caller's options

`viewAsPairs` looks up a slice per unmated read, and those collapse to a
handful. They are deduplicated on the triple that identifies a slice; keying on
`Slice.toString()` silently collapsed every one of them to `[object Object]`.
They are also decoded under the whole `opts`, not just the signal — `decodeTags`
is part of the cache key, so a mate pass with different options decodes and
caches a second copy of a slice the first pass already had.

## Decoding a slice

### The unit of parallel work is the whole slice

Slices are independent, so they decode on a shared worker pool — on by default,
since the worker ships inlined. Parallelizing only _decompression_, as
`@gmod/bgzf-filehandle` does for BAM, was measured and rejected: at 24–35% of a
query, Amdahl caps it at ~1.33x, and the heavy blocks within one slice are too
few to spread. The whole slice is ~95% of a query, and measures **2.0–2.8x**
under node and **2.1–3.6x** from four slices up when nested inside a browser
worker, which is the arrangement consumers actually ship.
[WORKERS.md](WORKERS.md) has the tables, including the slice-count threshold
that was measured for and rejected.

### The wasm boundary is the block

Every block codec is compiled C rather than JS — samtools' own htscodecs for the
CRAM-specific ones, libdeflate for gzip, and a second 16 KB module for lzma. The
boundary sits at **one block**, because each crossing copies its input in and
its output back: a block's two copies amortize over the thousands of records in
it, where crossing per record would put the copies inside the hot loop.
Everything above the block — the per-data-series codecs and the record decode —
stays in JS, where it is reading bytes that are already in the JS heap.
[WASM.md](WASM.md#where-the-boundary-is-drawn) has the other two axes of that
decision.

### Per-slice work happens once per slice

`buildSliceDecodeContext` assembles everything the record loop reads against
before the loop runs: classifying external blocks, pre-decoding the integer
ones, binding a decoder per data series and per tag, opening the columns.

The binding is the codec's own job rather than a fast path written next to the
loop. An `instanceof` chain that recognized particular codec combinations was
tried first, and its failure mode is the argument: a combination nobody
enumerated fell through to full dispatch silently, which happened twice — one of
them putting `getBytesSubarray` at 6.1% of the SRR396637 profile, 109,580 calls
for 54,695 records. A binder that cannot do better returns `undefined` and the
caller has a correct slower path, so adding one never adds a way to be wrong
([ADR 0001](adr/0001-codec-binding-seam.md)).

### Strings are decoded a block at a time

`byteArrayStop` stores its values end to end, so the block _is_ the strings: one
`TextDecoder` call recovers all of them and each read is an `indexOf` and a
`slice`. Decoding SRR396637's 54,695 read names one at a time is **10.4 ms**
against **1.5 ms** for the block — 86% of it was per-call overhead — and the
call count for the whole file went **110,048 → 240**.

The alternative was to make the name lazy, which is genuinely attractive because
a plain pileup render never asks for one. It lost on memory: a record holding a
`Uint8Array` view over its name costs 104 bytes to defer ~56 bytes of string,
and patching the getter never to materialize took SRR396637 from 37.7 MB to
40.9. **Defer a computation, not a view**
([ADR 0002](adr/0002-batch-decoding-over-lazy-fields.md)).

Read bases take the same shape where the codec allows it: `bindBytesReader`
hands out a view straight off the BA block, and `decodeReadBases` falls back to
a base at a time only when it cannot.

### External integer blocks are decoded in one pass

`batchDecodeItf8` decodes a whole external ITF8 block into an `Int32Array` up
front instead of parsing a variable-length integer per read. The scratch array
is sized at one element per byte, which looks like a 4x over-allocation and is
not — measured utilization is 97.5–100%, because these values are overwhelmingly
single-byte, and the copy-out path fires on 0.15 MB of 14.70 MB.

### Columns, not objects

Read features, quality scores and aux tags are stored as one set of typed arrays
per slice plus an offset per record, rather than as objects per record. A
retained `Uint8Array` view is **104 bytes whatever it points at**, so a
per-record view over ~100 bytes costs more than the bytes; the columns pay that
fixed cost once per slice. Read features go from 64–81 bytes each to 19, and the
quality column removed 104 bytes per record (−12.8% retained on SRR396637).

The columns are per slice and not per record for the same reason in the other
direction — giving each record its own typed arrays makes short-read files about
twice as expensive as plain objects. [MEMORY.md](MEMORY.md#columns-not-objects)
has the numbers, and [READ_FEATURES.md](READ_FEATURES.md) how to read them.

`TagColumn` is the exception, and worth knowing before anyone "improves" it on
the assumption that it saved heap: it came out break-even (−0.06 MB on
SRR396637, +0.20 MB on SRR396636) and was taken for the worker transfer below
and for `getTag`.

### Out of the worker by transfer, not by clone

A decoded slice cannot travel as `CramRecord[]` — a class instance loses its
prototype — and cloning the records as plain objects measured **1011 ms against
a 392 ms decode**, which would have made the pool pointless. `sliceTransfer.ts`
sends the columns instead: they are already typed arrays, so they transfer at
zero copy, and the per-record scalars pack into one `Int32Array`. Tags alone
were 243 ms of structured clone and are 11 ms as columns. Strings stay strings —
15 ms for 153,677 of them, against 112 ms to encode the same set into bytes.

## Handing records back

### Walks, not arrays

CRAM stores no CIGAR, so every CIGAR this library produces is synthesized: any
array form would be an allocation the library invented and imposed on every
consumer, not a view onto something the file contains. `forEachCigarOp` and
`forEachMismatch` are the primitives, and `getCigarString`/`getMismatches` are
built on them ([ADR 0006](adr/0006-cigar-as-a-callback-walk.md)).

The callback is the consumer's own, not a translating one. Putting a translation
between this walk and jbrowse's cost **+17%** — the same indirect call, paid
twice — so the emitted vocabulary is the one the consumer wants
([ADR 0008](adr/0008-emit-into-the-consumers-callback.md)).

### One tag, one score, one clip length

Each of these answers a question without materializing the structure that would
answer all of them:

- `getTag(name)` reads one tag out of the column, **3.8–7.8x** faster than
  building the `tags` object — and minimap2 output carries 11 tags on every
  read, so a filter on one tag was decoding all eleven.
- `qualityScoreAt(i)` allocates nothing, where `record.qualityScores[i]` builds
  a view per call. For a loop over every base, hoist `qualityColumn` and
  `qualityStart`.
- `getLeadingClipLength()` / `getTrailingClipLength()` answer off the features
  at that end. Reading the same number out of a packed CIGAR meant manufacturing
  the whole array — ~7,000 operations for a long ONT read — to look at one of
  them.

### Cancellation reaches the socket, without leaking

`getRecordsForRange` takes a `signal`, and the signal is checked before each
read is issued as well as handed to the filehandle, because honouring it down
there is optional — `RemoteFile` aborts its `fetch`, `LocalFile` ignores it.

The hazard is that the read path is a stack of memoized promises, and a memo
cannot tell whose cancellation it is seeing. So reads that are shared between
queries — the index parse, a decoded slice — are reference-counted, and aborting
one query never fails another
([ADR 0003](adr/0003-abortsignal-on-the-read-path.md)). The corollary is worth
knowing: a query with **no** signal can never give up, so it pins whatever it is
waiting on for everyone.

## What a consumer adds

jbrowse-components is the consumer these were measured against, and several of
the wins are on its side of the API. They are worth reading as the pattern for
any consumer doing the same volume.

**Budget across files, not per file.** `cacheSize` is per `CramFile`, and
jbrowse holds one per open track for the life of the track — so the ceiling is
multiplied by the track count and nothing bounds the sum. Its `CramAdapter`
passes a per-JS-context `SharedBudget` instead, so a track the reader is not
looking at yields its space to the one being panned. Dividing the ceiling by the
track count is the obvious fix and is measurably worse than doing nothing.

**Size the pool for the host, not for the query.** The pool is shared per JS
context, and jbrowse round-robins tracks over up to five RPC workers, so five
CRAM tracks start five pools — 20 slice workers at the library default of 4. It
passes `numSliceWorkers: max(2, min(4, cores/2))`, which costs a single track a
little (220 → 241 ms on 4 cores) so that five tracks gain a lot (1347 → 956 ms)
([ADR 0009](adr/0009-one-pool-per-context-sized-for-the-host.md)).

**A byte-range cache underneath.** `RemoteFileWithRangeCache` caches per 256 KiB
chunk and joins reads already in flight, which is what makes this library's
remaining duplicate reads — `readBlock` probes a block header at a position and
then reads the block at the same position — a cache hit rather than a second
request. Over a local file they are real syscalls; see [TODO.md](../TODO.md).

**Ask for one thing at a time.** Its record filter calls `getTag` rather than
reading `record.tags`, its render path reads `clipLengthAtStartOfRead` rather
than a packed CIGAR, and the packed CIGAR it does build is built only when a
consumer asks for the packed form, as a `Uint32Array` above 64 operations and a
plain array below — where ~96 bytes of typed-array overhead on a one-element
payload is 2.4x the memory and ~2x slower.

**Reuse the options object.** `forEachMismatch` takes its window as an object,
and a fresh literal per read per render pass measured 16.5 → 20.7 ms on 80,177
short reads. The library reads all three fields before the walk starts and
retains none of them, so one shared literal is safe.

**Gate the query on the index.** `bytesForRegions` sums `sliceBytes` from the
`.crai` to decide whether a region is too big to fetch, deduplicating slices
across regions first — adjacent regions routinely overlap one slice, and it is
downloaded once. Note what that gate does to everything above it: a pileup
capped at 5 MB lives permanently in the 19–40 kb band, which is the shallow end
of the pool's curve, and is most of why the end-to-end win there is ~1.1x while
the decode alone is 2.2x. The pool is worth much more to a whole-contig scan, an
export or a force-load.

## What was measured and rejected

[ADR 0007](adr/0007-optimizations-measured-and-rejected.md) is the list, with
the numbers: interning the decoded strings (real duplication, −6.5% retained,
and 10–20% of the decode to hash it), a positional `CramRecord` constructor,
coalescing single-base insertions at decode time, a short-buffer fast path in
`decodeUtf8`, hidden-class stability that was already stable. Read it before
proposing an optimization.

[TODO.md](../TODO.md) has the opposite list — measured, still open, wanted — and
a method note on how to A/B this repo without fooling yourself, which is worth
reading first if you intend to add anything to either.
