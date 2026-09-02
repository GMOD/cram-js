# Optimizations

Why the query path looks the way it does. [dataflow.md](dataflow.md) walks the
path itself.

CRAM spends its time somewhere different from the BGZF formats. Block
decompression accounts for only **24–35%** of a cold query, so what dominates is
the **record decode** and what the decoded records **retain** — the reader
decodes a slice whole and caches it whole. Nearly everything below is one of two
moves: do per-slice work once per slice rather than once per record, and refuse
to pay a fixed per-object cost on a 100 bp read.

Each item names the measurement that settled it. Where a whole decision hangs on
it there is an [ADR](adr/);
[ADR 0007](adr/0007-optimizations-measured-and-rejected.md) lists the things
that looked like wins and were not.

## Reading the index

### Parsed once, shared across callers

The first query reads the whole `.crai`, inflates it, parses it, and memoizes
the result for the life of the object. It is the one read in `CraiIndex` that
several queries share, so a caller that joined someone else's parse and saw it
fail because _that_ caller aborted starts over rather than inheriting the
failure — once, then propagates.

### The overlap scan stops at both ends

Entries come sorted by start, so `getEntriesForRange` binary-searches the lower
bound at `queryStart - maxSpan` — the longest span on that reference, computed
at parse time — and stops the forward scan at `queryEnd` rather than running to
the end of the chromosome.

It used to filter the whole reference's entry list on every call. A whole-genome
`.crai` is hundreds of thousands of slices, and `viewAsPairs` calls this once
per unmated read, so a query returning n reads did O(n × slices) work to find a
handful of slices.

### Accumulate digits, don't build strings

`parseIndex` walks the decompressed text byte by byte and accumulates each field
numerically. The `parseInt` of a built-up substring dominated index load on the
whole-genome files this is really sized for.

## Choosing and fetching slices

### One read per slice

A slice is read whole — header block and data blocks in one byte range, sized
from the `.crai`, or from the container's landmarks when there is no index — and
its header parsed out of that buffer. It used to be three reads: `readBlock`
probed the header block's own header, read the block again, and then the data
blocks were fetched separately. The container's compression header block is one
read for the same reason: the first landmark says exactly how long it is. A
whole-reference query on `ce#1000` went from 546 reads, half under 80 bytes, to
231 — one per slice and three per container. Over a byte-range cache those were
already hits; locally they were syscalls and copies.

### The reference is fetched alongside the decode, not after it

`applyReferenceSequence` asks for the extent of a slice's reads, which it only
knows once the slice is decoded — so every slice used to pay slice read, decode,
reference read, resolve in series, and a consumer's sequence source is usually
remote. The slice's declared span is the same extent, and the `.crai` carries
it, so the fetch now starts before the slice's own bytes are read and the decode
joins it. Measured over every indexed fixture, the declared span equals the
reads' extent on every slice but one, where an unmapped read placed past it
costs the exact fetch it always cost. jbrowse's integration notes had carried
this as their open "seam 1"; bam-js measured the equivalent at 1.5x on a pan.

### The slices of one query share their containers

A CRAM packs several slices per container, so without this every slice re-read
its container header and re-parsed its compression header block: on `ce#1000`,
149 slices over ~30 containers left **456 of 1001** filehandle reads exact
duplicates of another read in the same query.

The map covers one query on purpose, and has to stay that way. A container's
memos carry the caller's `AbortSignal` on a first-caller-wins basis, which is
sound only while every caller of one memo is the same query — a file-level
container cache needs the foreign-abort handling the record cache and
`CraiIndex` have ([ADR 0003](adr/0003-abortsignal-on-the-read-path.md), and
[TODO.md](../TODO.md) for the part still open).

### Size the decoded-slice cache above one query

`featureCache` holds decoded records, keyed by slice position and by the decode
options that would change what a slice decodes to. It counts **records** — a
decoded record has no cheap size, and slices hold anywhere from a handful of
records to tens of thousands — and the default is 1,000,000 because the number
has to clear one query's working set. Below that it does not cache less, it
caches _nothing_: each slice falls out before the next pan can reuse it while
still holding the memory. A 50 kb window on 200x short-read data is 90,000
records, and the old 20,000 default sat 4.5x below it
([ADR 0004](adr/0004-size-the-slice-cache-above-one-query.md)).

Eviction is plain LRU, so the bound means what it says. It used to be a
`'batch'` policy that spared everything an in-flight query touched — measured
holding 420,000 records against a stated 20,000 — which rescues an undersized
budget by exceeding it. Above the working set the two measure identically, so
that policy went ([ADR 0005](adr/0005-drop-the-batch-eviction-policy.md)).
`cacheIdleTimeoutMs` is what lowers the cache while nothing is happening, and
`cacheBudget` lets several files share one ceiling instead of each holding its
own. [memory.md](memory.md#the-slice-cache) has both.

The cache holds the whole decoded slice, already decorated with its reference
sequence — `applyReferenceSequence` runs once per slice inside the cached decode
rather than once per query over the filtered subset — and the filter runs over
those cached records afterwards. So a pan that re-asks for a different window of
the same slice pays nothing but the filter.

### Mate slices dedupe, and decode under the caller's options

`viewAsPairs` looks up a slice per unmated read, and those collapse to a
handful. They dedupe on the triple that identifies a slice; keying on
`Slice.toString()` silently collapsed every one of them to `[object Object]`.
They also decode under the whole `opts`, not just the signal — `decodeTags` is
part of the cache key, so a mate pass with different options decodes and caches
a second copy of a slice the first pass already had.

## Decoding a slice

### The unit of parallel work is the whole slice

Slices are independent, so they decode on a shared worker pool — on by default,
since the worker ships inlined. We measured parallelizing only _decompression_,
as `@gmod/bgzf-filehandle` does for BAM, and rejected it: at 24–35% of a query,
Amdahl caps it at ~1.33x, and the heavy blocks within one slice are too few to
spread. The whole slice is ~95% of a query, and measures **2.0–2.8x** under node
and **2.1–3.6x** from four slices up when nested inside a browser worker, which
is the arrangement consumers actually ship. [workers.md](workers.md) has the
tables, including the slice-count threshold we measured for and rejected.

### GPU compute shaders not currently pursued

Compute shaders are the obvious next question once a consumer already has a GPU
in the picture — [JBrowse 2](https://jbrowse.org/jb2/) runs one, and asked it.
The answer is no, and the reason is shape rather than effort.

A GPU wants thousands of lanes doing the same thing to adjacent data. The
parallelism CRAM decompression offers is either much narrower than that or much
coarser:

- **Within a codec, the width is a handful of lanes.** rANS interleaves 4
  streams, or 32 in the `r32x16` and striped sub-variants — a width picked to
  fill CPU vector registers, not a GPU. `arith` and `fqzcomp` are adaptive: each
  symbol updates the model the next one is decoded against, so within one stream
  they are sequential by construction.
- **Above the codecs, the independent unit is the slice** — and that is already
  taken. The worker pool decodes whole slices in parallel (above), which is the
  same parallelism a GPU would be reaching for, spent already and on a device
  that can also run the record decode.

Amdahl finishes it. Block decompression is **24–35%** of a cold query, so even a
decompressor that cost nothing caps the whole query between ~1.3x and ~1.5x —
the same ceiling the worker-pool item above runs into — and the record decode it
would leave behind is branchy pointer-chasing work that does not belong on a GPU
at all. Add a host-to-device round trip per block and the ceiling drops further.

This one is reasoned from the structure rather than measured — unlike everything
else on this page — because the structure decides it before a benchmark would.
What would reopen it is a CRAM profile whose decompression share is far above
35%, or a codec sub-variant with thousands of independent streams.

### The wasm boundary is the block

Every block codec is compiled C rather than JS — samtools' own htscodecs for the
CRAM-specific ones, libdeflate for gzip, and a second module for lzma. The
boundary sits at **one block**, because each crossing copies its input in and
its output back: a block's two copies amortize over the thousands of records in
it, where crossing per record would put the copies inside the hot loop.
Everything above the block — the per-data-series codecs and the record decode —
stays in JS, where it is reading bytes that are already in the JS heap.
[wasm.md](wasm.md#where-the-boundary-is-drawn) has the other two axes of that
decision.

### Per-slice work happens once per slice

`buildSliceDecodeContext` assembles everything the record loop reads against
before the loop runs: classifying external blocks, pre-decoding the integer
ones, binding a decoder per data series and per tag, opening the columns.

The binding is the codec's own job rather than a fast path written next to the
loop. We tried an `instanceof` chain that recognized particular codec
combinations first, and its failure mode is the argument: a combination nobody
enumerated fell through to full dispatch silently, which happened twice — one of
them putting `getBytesSubarray` at 6.1% of the SRR396637 profile, 109,580 calls
for 54,695 records. A binder that cannot do better returns `undefined` and the
caller has a correct slower path, so adding one never adds a way to be wrong
([ADR 0001](adr/0001-codec-binding-seam.md)).

### Decode strings a block at a time

`byteArrayStop` stores its values end to end, so the block _is_ the strings: one
`TextDecoder` call recovers all of them and each read is an `indexOf` and a
`slice`. Decoding SRR396637's 54,695 read names one at a time takes **10.4 ms**
against **1.5 ms** for the block — 86% of that went on per-call overhead — and
the call count for the whole file went **110,048 → 240**.

The alternative was to make the name lazy, which is genuinely attractive because
a plain pileup render never asks for one. It lost on memory: a record holding a
`Uint8Array` view over its name costs 104 bytes to defer ~56 bytes of string,
and patching the getter never to materialize took SRR396637 from 37.7 MB to
40.9. **Defer a computation, not a view**
([ADR 0002](adr/0002-batch-decoding-over-lazy-fields.md)).

Read bases take the same shape where the codec allows it: `bindBytesReader`
hands out a view straight off the BA block, and `decodeReadBases` falls back to
a base at a time only when it cannot.

### Decode external integer blocks in one pass

`batchDecodeItf8` decodes a whole external ITF8 block into an `Int32Array` up
front instead of parsing a variable-length integer per read. The scratch array
takes one element per byte, which looks like a 4x over-allocation and is not —
measured utilization is 97.5–100%, because these values are overwhelmingly
single-byte, and the copy-out path fires on 0.15 MB of 14.70 MB.

### Columns, not objects

Read features, quality scores and aux tags live in one set of typed arrays per
slice plus an offset per record, rather than in objects per record. A retained
`Uint8Array` view costs **104 bytes whatever it points at**, so a per-record
view over ~100 bytes costs more than the bytes; the columns pay that fixed cost
once per slice. Read features go from 64–81 bytes each to 15, and the quality
column saved 104 bytes per record (−12.8% retained on SRR396637).

The columns belong to the slice and not to the record for the same reason in the
other direction — giving each record its own typed arrays makes short-read files
about twice as expensive as plain objects.
[memory.md](memory.md#columns-not-objects) has the numbers, and
[read-features.md](read-features.md) how to read them.

Anything derivable gets no column at all. Payload offsets had one, at 4 bytes
each, until it turned out they were the running prefix sum of lengths the arena
already had — and that three quarters of them pointed at a feature carrying no
bytes. One checkpoint every eighth slot replaced them, for −9.4% retained heap
on a long-read slice with the accessors unchanged
([ADR 0010](adr/0010-checkpoint-the-payload-offsets.md)).

`TagColumn` is the exception, and worth knowing before anyone "improves" it on
the assumption that it saved heap: it came out break-even (−0.06 MB on
SRR396637, +0.20 MB on SRR396636), and it earns its place through the worker
transfer below and through `getTag`.

### A record is a view onto its slice's columns

The decode writes no per-record object at all. The per-record scalars go into
one `Int32Array` beside the read-feature, tag and quality columns, and that
column set — `DecodedSlice` — is what the cache holds and what a worker sends. A
`CramRecord` is two numbers, the slice and an index, with a getter per field.

Cloning per-record objects across the worker boundary measured **1011 ms against
a 392 ms decode**, which is why columns travel; but packing them on the worker
and rebuilding an object per record on the host, which is what the wire form
did, was still a serial 0.5 µs a record — a quarter of the in-process decode on
SRR396637, and the term that capped the pool's speedup. Now the slice is usable
as it lands. It also removes the record object from what a short-read slice
retains, which was most of it ([ADR 0012](adr/0012-records-are-views.md)). Tags
alone were 243 ms of structured clone and are 11 ms as columns. Strings stay
strings — 15 ms for 153,677 of them, against 112 ms to encode the same set into
bytes.

## Handing records back

### Walks, not arrays

CRAM stores no CIGAR, so this library synthesizes every one it produces: any
array form would be an allocation the library invented and imposed on every
consumer, not a view onto something the file contains. `forEachCigarOp` and
`forEachMismatch` are the primitives, and `getCigarString`/`getMismatches` sit
on top of them ([ADR 0006](adr/0006-cigar-as-a-callback-walk.md)).

The callback is the consumer's own, not a translating one. Putting a translation
between this walk and jbrowse's cost **+17%** — the same indirect call, paid
twice — so the walk emits the vocabulary the consumer wants
([ADR 0008](adr/0008-emit-into-the-consumers-callback.md)).

### no_ref files make the mismatch walk much slower

Normally `forEachMismatch` skips along a handful of read features per read.
Files written with `samtools view --output-fmt-option no_ref` are different.
That encoder has no reference to compare against, so it never works out which
bases are substitutions — it dumps every base into a `b` feature and moves on.
Reading one back, the walk has to do that comparison itself, base by base,
across the whole read.

Comparing base by base runs about 7 ns per aligned base, and it stays about 7 ns
whether the reads are 100bp or 20kb. So what drives the bill is how much
alignment is in view, not how long the reads are.

A file with no `b` features is unaffected, and nothing else about the walk
changes. Worth knowing that this cost is ours and not samtools': it reads a
no_ref file just as fast as any other, because all it does is hand back the
bases the file already stores. Nobody pays for the missing substitutions until
somebody asks what they are, which is why these files can be in wide use without
anyone noticing this.

The other thing a no_ref file costs is space, about **1.7x** on real reads —
200,000 of them took 493 KB against 293 KB written against a reference. Don't
read more than that into the fixtures in this repo: their quality strings are
synthetic and compress to nearly nothing, which leaves the sequence looking like
the whole file. In a real CRAM the quality scores dominate, and they are
identical either way.

### One tag, one score, one clip length

Each of these answers a question without materializing the structure that would
answer all of them:

- `getTag(name)` reads one tag out of the column, **3.8–7.8x** faster than
  building the `tags` object — and minimap2 output carries 11 tags on every
  read, so a filter on one tag used to decode all eleven.
- `qualityScoreAt(i)` allocates nothing, where `record.qualityScores[i]` builds
  a view per call. For a loop over every base, hoist `qualityColumn` and
  `qualityStart`.
- `getLeadingClipLength()` / `getTrailingClipLength()` answer off the features
  at that end. Reading the same number out of a packed CIGAR means manufacturing
  the whole array — ~7,000 operations for a long ONT read — to look at one of
  them.

### Cancellation reaches the socket, without leaking

`getRecordsForRange` takes a `signal`, and checks it before issuing each read as
well as handing it to the filehandle, because honouring it down there is
optional — `RemoteFile` aborts its `fetch`, `LocalFile` ignores it.

The hazard is that the read path is a stack of memoized promises, and a memo
cannot tell whose cancellation it is seeing. So the reads several queries share
— the index parse, a decoded slice — carry a reference count, and aborting one
query never fails another
([ADR 0003](adr/0003-abortsignal-on-the-read-path.md)). The corollary is worth
knowing: a query with **no** signal can never give up, so it pins whatever it is
waiting on for everyone.

## What a consumer adds

We measured all of this against jbrowse-components, and several of the wins sit
on its side of the API. They are worth reading as the pattern for any consumer
doing the same volume.

**Budget across files, not per file.** `cacheSize` is per `CramFile`, and
jbrowse holds one per open track for the life of the track — so the track count
multiplies the ceiling and nothing bounds the sum. Its `CramAdapter` passes a
per-JS-context `SharedBudget` instead, so a track the reader is not looking at
yields its space to the one they are panning. Dividing the ceiling by the track
count is the obvious fix and measures worse than doing nothing.

**Size the pool for the host, not for the query.** One pool serves a whole JS
context, and jbrowse round-robins tracks over up to five RPC workers, so five
CRAM tracks start five pools — 20 slice workers at the library default of 4. It
passes `numSliceWorkers: max(2, min(4, cores/2))`, which costs a single track a
little (220 → 241 ms on 4 cores) so that five tracks gain a lot (1347 → 956 ms)
([ADR 0009](adr/0009-one-pool-per-context-sized-for-the-host.md)).

**A byte-range cache underneath.** `RemoteFileWithRangeCache` caches per 256 KiB
chunk and joins reads already in flight, so the one read per slice above and the
handful per container land in a few requests rather than one each.

**Ask for one thing at a time.** Its record filter calls `getTag` rather than
reading `record.tags`, its render path reads `clipLengthAtStartOfRead` rather
than a packed CIGAR, and it builds a packed CIGAR only where a consumer asks for
the packed form, as a `Uint32Array` above 64 operations and a plain array below
— where ~96 bytes of typed-array overhead on a one-element payload is 2.4x the
memory and ~2x slower.

**Reuse the options object.** `forEachMismatch` takes its window as an object,
and a fresh literal per read per render pass measured 16.5 → 20.7 ms on 80,177
short reads. The library reads all three fields before the walk starts and
retains none of them, so one shared literal is safe.

**Gate the query on the index.** `bytesForRegions` sums `sliceBytes` from the
`.crai` to decide whether a region is too big to fetch, deduplicating slices
across regions first — adjacent regions routinely overlap one slice, which then
downloads once. Note what that gate does to everything above it: a pileup capped
at 5 MB lives permanently in the 19–40 kb band, which is the shallow end of the
pool's curve, and is most of why the end-to-end win there is ~1.1x while the
decode alone is 2.2x. The pool is worth much more to a whole-contig scan, an
export or a force-load.

## What we measured and rejected

[ADR 0007](adr/0007-optimizations-measured-and-rejected.md) keeps the list, with
the numbers: interning the decoded strings (real duplication, −6.5% retained,
and 10–20% of the decode to hash it), a positional `CramRecord` constructor,
coalescing single-base insertions at decode time, a short-buffer fast path in
`decodeUtf8`, hidden-class stability that was already stable. Read it before
proposing an optimization.

[TODO.md](../TODO.md) has the opposite list — measured, still open, wanted — and
a method note on how to A/B this repo without fooling yourself, which is worth
reading first if you intend to add anything to either.
