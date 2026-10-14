# Optimizations

This page explains why the query path looks the way it does.
[dataflow.md](dataflow.md) walks the path itself.

CRAM spends its time somewhere different from the BGZF formats. Block
decompression accounts for only **24–35%** of a cold query, so the **record
decode** and the memory the decoded records **retain** dominate, because the
reader decodes a slice whole and caches it whole. Nearly every optimization
below does one of two things: it does per-slice work once per slice rather than
once per record, or it avoids a fixed per-object cost on a 100 bp read.

Each item names the measurement that settled it. Where a whole decision depends
on it there is an [ADR](adr/);
[ADR 0007](adr/0007-optimizations-measured-and-rejected.md) lists the things
that looked like wins and were not.

## Reading the index

### Parsed once, shared across callers

The first query reads the whole `.crai`, inflates it, parses it, and memoizes
the result for the life of the object. The parse is the one read in `CraiIndex`
that several queries share, so it is reference-counted: the parse aborts only
once every caller waiting on it has aborted, and each caller rejects on its own
abort alone.

### The overlap scan stops at both ends

Entries come sorted by start, so `getEntriesForRange` binary-searches the lower
bound at `queryStart - maxSpan` — the longest span on that reference, computed
at parse time — and stops the forward scan at `queryEnd` rather than running to
the end of the chromosome.

`getEntriesForRange` used to filter the whole reference's entry list on every
call. A whole-genome `.crai` is hundreds of thousands of slices, and
`viewAsPairs` calls this once per unmated read, so a query returning n reads did
O(n × slices) work to find a handful of slices.

### Accumulate digits, don't build strings

`parseIndex` walks the decompressed text byte by byte and accumulates each field
numerically. The `parseInt` of a built-up substring dominated index load on the
whole-genome files the parser is built for.

## Choosing and fetching slices

### One read per slice

The reader fetches a slice whole, header block and data blocks in one byte
range, sized from the `.crai` or, when there is no index, from the container's
landmarks. It then parses the slice header out of that buffer. A slice used to
take three reads: `readBlock` probed the header block's own header, read the
block again, and then the data blocks were fetched separately. The container's
compression header block is one read for the same reason, because the first
landmark gives its exact length. The reader used to read the container header in
two pieces, because its landmark count is in the fixed-size first half. It now
makes one speculative read with room for 32 landmarks, and re-reads only when a
container has more (no fixture here has over five). A whole-reference query on
`ce#1000` went from 546 reads, half under 80 bytes, to 202 — one per slice and
two per container. Over a byte-range cache those were already hits; locally they
were syscalls and copies.

### The reference is fetched alongside the decode, not after it

`applyReferenceSequence` asks for the extent of a slice's reads, which is known
only once the slice is decoded. Every slice therefore used to run slice read,
decode, reference read and resolve in series, and a consumer's sequence source
is usually remote. The slice's declared span is the same extent, and the `.crai`
records it, so the fetch now starts before the slice's own bytes are read and
the decode joins it. Over every indexed fixture, the declared span equals the
reads' extent on every slice but one, where an unmapped read placed past it
costs the exact fetch it always cost. jbrowse's integration notes had listed
this as their open "seam 1"; bam-js measured the equivalent at 1.5x on a pan.

### The slices of one query share their containers

A CRAM packs several slices per container, so without sharing, every slice
re-read its container header and re-parsed its compression header block. On
`ce#1000`, with 149 slices over ~30 containers, **456 of 1001** filehandle reads
were exact duplicates of another read in the same query.

The container map covers one query on purpose, and has to stay that way. A
container's memos take the caller's `AbortSignal` on a first-caller-wins basis,
which is sound only while every caller of one memo is the same query. A
file-level container cache would need the foreign-abort handling that the record
cache and `CraiIndex` have
([ADR 0003](adr/0003-abortsignal-on-the-read-path.md), and [TODO.md](../TODO.md)
for the part still open).

### Size the decoded-slice cache above one query

`featureCache` holds decoded slices, keyed by slice position and by the decode
options that would change what a slice decodes to, and weighs them in bytes. The
default of 1 GB, the same as `@gmod/bam`, clears one query's working set; a
smaller budget evicts each slice before the next pan can reuse it. Eviction is
plain LRU, and [memory.md](memory.md#the-slice-cache) has the numbers, and ADRs
[0004](adr/0004-size-the-slice-cache-above-one-query.md),
[0005](adr/0005-drop-the-batch-eviction-policy.md) and
[0013](adr/0013-weigh-the-slice-cache-in-bytes.md) the decisions.

The cache holds the whole decoded slice with its reference sequence already
applied, because `applyReferenceSequence` runs once per slice inside the cached
decode rather than once per query over the filtered subset. The range filter
runs over those cached records afterwards, so a pan that asks for a different
window of the same slice costs only the filter.

### The range filter reads the columns

A warm query costs only its range filter, and the filter used to build a record
view — the consumer's `recordClass` — for every record in each slice just to
read three numbers off it. It now reads the sequence id, start and span straight
from the slice's columns and builds a view only for a record that overlaps.

On 1 kb windows over cached slices, the change took a warm query from 0.21–0.43
ms to 0.13–0.20 ms on SRR396637 (−38% and −53% in two runs) and cut SRR396636 by
54% and 56%, against A-vs-A controls within 10%. A 20 kb window gains less (−9%
to −17%), because more of each slice passes the filter and still gets a view; on
one run the gain was inside the control. The decode dominates a cold query,
which did not change measurably.

### Mate slices dedupe, and decode under the caller's options

`viewAsPairs` looks up a slice per unmated read, and those lookups reduce to a
handful of distinct slices. The lookups dedupe on the triple that identifies a
slice. Keying on `Slice.toString()` gave every slice the same key,
`[object Object]`, and raised no error. The mate slices also decode under the
whole `opts`, not just the signal. `decodeTags` is part of the cache key, so a
mate pass with different options decodes and caches a second copy of a slice the
first pass already had.

## Decoding a slice

### The unit of parallel work is the whole slice

Slices are independent, so they decode on a shared worker pool — on by default,
since the worker ships inlined. We measured parallelizing only _decompression_,
as `@gmod/bgzf-filehandle` does for BAM, and rejected it: at 24–35% of a query,
Amdahl caps it at ~1.33x, and the heavy blocks within one slice are too few to
spread. Decoding whole slices covers ~95% of a query, and the pool measures
**2.0–2.8x** under node and **2.1–3.6x** from four slices up when nested inside
a browser worker, which is the arrangement consumers ship.
[workers.md](workers.md) has the tables, including the slice-count threshold we
measured for and rejected.

### GPU compute shaders not currently pursued

[JBrowse 2](https://jbrowse.org/jb2/) already uses a GPU and asked about compute
shaders. A GPU wants thousands of lanes doing the same thing to adjacent data,
and the parallelism in CRAM decompression is either much narrower or much
coarser:

- **Within a codec, the width is a handful of lanes.** rANS interleaves 4
  streams, or 32 in the `r32x16` and striped sub-variants — a width picked to
  fill CPU vector registers, not a GPU. `arith` and `fqzcomp` are adaptive: each
  symbol updates the model the next one is decoded against, so within one stream
  they are sequential by construction.
- **Above the codecs, the independent unit is the slice**, and the worker pool
  already decodes whole slices in parallel (above). That is the parallelism a
  GPU would use, and the pool runs it on CPUs, which can also run the record
  decode.

At 24–35% of a cold query, even a decompressor that took no time would cap the
speedup at ~1.3–1.5x, before a host-to-device round trip per block, and the
record decode left behind is branchy work that does not belong on a GPU. Unlike
everything else on this page, this decision comes from structure, not
measurement. A CRAM profile whose decompression share is far above 35%, or a
codec sub-variant with thousands of independent streams, would reopen it.

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

Each codec does its own binding, rather than relying on a fast path written next
to the loop. We first tried an `instanceof` chain that recognized particular
codec combinations. A combination nobody had enumerated fell through to full
dispatch with no warning, and that happened twice; one of them put
`getBytesSubarray` at 6.1% of the SRR396637 profile, 109,580 calls for 54,695
records. A binder that cannot do better returns `undefined` and the caller has a
correct slower path, so a new binder can make a read faster but cannot make it
wrong ([ADR 0001](adr/0001-codec-binding-seam.md)).

### Decode strings a block at a time

`byteArrayStop` stores its values end to end, so the block holds the strings in
order. One `TextDecoder` call recovers all of them, and each read is an
`indexOf` and a `slice`. Decoding SRR396637's 54,695 read names one at a time
takes **10.4 ms** against **1.5 ms** for the block (86% of that was per-call
overhead), and the call count for the whole file went **110,048 → 240**.

A lazy read name lost on memory, because the view it held cost more than the
string; see [memory.md](memory.md#laziness-that-holds-a-view-is-a-pessimization)
and [ADR 0002](adr/0002-batch-decoding-over-lazy-fields.md).

Read bases get the same treatment where the codec allows it: `bindBytesReader`
returns a view directly onto the BA block, and `decodeReadBases` falls back to a
base at a time only when it cannot.

### Decode external integer blocks in one pass

`batchDecodeItf8` decodes a whole external ITF8 block into an `Int32Array` up
front instead of parsing a variable-length integer per read. The scratch array
takes one element per byte, which looks like a 4x over-allocation. Measured
utilization is 97.5–100%, because these values are overwhelmingly single-byte,
and the copy-out path runs on 0.15 MB of 14.70 MB.

### Columns, not objects

Read features, quality scores and aux tags are stored in one set of typed arrays
per slice plus an offset per record. A retained `Uint8Array` view costs **104
bytes whatever it points at**, so columns let the slice pay that fixed cost
once: read features go from 64–81 bytes each to 15, and the quality column cut
retained heap 12.8% on SRR396637. Payload offsets, derivable from the arena,
became one checkpoint every eighth slot (−9.4% on a long-read slice,
[ADR 0010](adr/0010-checkpoint-the-payload-offsets.md)).
[memory.md](memory.md#columns-not-objects) has the numbers.

`TagColumn` saved no heap (break-even on both short-read fixtures). We kept it
for the worker transfer below and for `getTag`, so don't "improve" it on the
assumption that it was a memory change.

### A record is a view onto its slice's columns

The decode writes no per-record object at all. The per-record scalars go into
one `Int32Array` beside the read-feature, tag and quality columns, and that
column set — `DecodedSlice` — is what the cache holds and what a worker sends. A
`CramRecord` is two numbers, the slice and an index, with a getter per field.

Cloning per-record objects across the worker boundary measured **1011 ms against
a 392 ms decode**, so workers send columns and the host uses the slice as it
arrives ([workers.md](workers.md#what-crosses-the-boundary)). Views also remove
the record object from what a short-read slice retains, and that object was most
of it ([ADR 0012](adr/0012-records-are-views.md)).

## Handing records back

### Walks, not arrays

CRAM stores no CIGAR, so this library synthesizes every one it produces. Any
array form would therefore be an allocation the library adds for every consumer,
rather than a view onto something the file contains. `forEachCigarOp` and
`forEachMismatch` are the primitives, and `getCigarString`/`getMismatches` are
built on them ([ADR 0006](adr/0006-cigar-as-a-callback-walk.md)).

The callback is the consumer's own, not a translating one. Putting a translation
between this walk and jbrowse's cost **+17%** (the same indirect call, made
twice), so the walk emits the vocabulary the consumer wants
([ADR 0008](adr/0008-emit-into-the-consumers-callback.md)).

### no_ref files make the mismatch walk much slower

Normally `forEachMismatch` skips along a handful of read features per read.
Files written with `samtools view --output-fmt-option no_ref` are different.
That encoder has no reference to compare against, so it never works out which
bases are substitutions, and writes every base into a `b` feature instead. When
reading such a file, the walk has to do that comparison itself, base by base,
across the whole read.

Comparing base by base runs about 7 ns per aligned base, and it stays about 7 ns
whether the reads are 100bp or 20kb. The cost therefore depends on how much
alignment is in view, not on how long the reads are.

A file with no `b` features is unaffected, and the rest of the walk is
unchanged. The cost is in this library, not in samtools: samtools reads a no_ref
file just as fast as any other, because it returns the bases the file already
stores. The comparison runs only when a caller asks for the substitutions, which
is why these files can be in wide use without anyone noticing the cost.

A no_ref file also costs space, about **1.7x** on real reads: 200,000 of them
took 493 KB, against 293 KB written against a reference. Don't read more than
that into the fixtures in this repo. Their quality strings are synthetic and
compress to nearly nothing, which leaves the sequence looking like the whole
file. In a real CRAM the quality scores dominate, and they are identical either
way.

### One tag, one score, one clip length

Each of these answers a question without materializing the structure that would
answer all of them:

- `getTag(name)` reads one tag out of the column, **3.8–7.8x** faster than
  building the `tags` object. minimap2 output has 11 tags on every read, so a
  filter on one tag used to decode all eleven.
- `qualityScoreAt(i)` allocates nothing, where `record.qualityScores[i]` builds
  a view per call. For a loop over every base, hoist `qualityColumn` and
  `qualityStart`.
- `getLeadingClipLength()` / `getTrailingClipLength()` read the clip from the
  features at that end. Reading the same number out of a packed CIGAR means
  building the whole array (~7,000 operations for a long ONT read) to look at
  one of them.

### Cancellation reaches the socket, without leaking

`getRecordsForRange` takes a `signal`, and checks it before issuing each read as
well as handing it to the filehandle, because a filehandle may ignore it:
`RemoteFile` aborts its `fetch`, and `LocalFile` ignores the signal.

The hazard is that the read path is a stack of memoized promises, and a memo
cannot tell whose cancellation it is seeing. The file definition, the SAM
header, the index parse and a decoded slice, which several queries share, are
therefore reference-counted, so aborting one query never fails another
([ADR 0003](adr/0003-abortsignal-on-the-read-path.md)). A query with **no**
signal can never give up, so it keeps whatever it is waiting on running for
everyone.

## What a consumer adds

We measured all of this against jbrowse-components, and several of the wins are
on its side of the API, where any consumer can copy them.

**Budget across files, not per file.** `maxCacheBytes` is per `CramFile`, and
jbrowse holds one per open track for the life of the track — so the track count
multiplies the ceiling and no limit applies to the sum. Its `CramAdapter` passes
a per-JS-context `SharedBudget` instead, so a track the reader is not looking at
yields its space to the one they are panning. Dividing the ceiling by the track
count is the obvious fix and measures worse than doing nothing.

**Size the pool for the host, not for the query.** One pool serves a whole JS
context, and jbrowse round-robins tracks over up to five RPC workers, so five
CRAM tracks start five pools, 20 slice workers at the library default of 4.
jbrowse passes `numSliceWorkers: max(2, min(4, cores/2))`, which costs a single
track a little (220 → 241 ms on 4 cores) so that five tracks gain a lot (1347 →
956 ms) ([ADR 0009](adr/0009-one-pool-per-context-sized-for-the-host.md)).

**Put a byte-range cache underneath.** `RemoteFileWithRangeCache` caches per 256
KiB chunk and joins reads already in flight, so this library's remaining
duplicate reads — `readBlock` probes a block header at a position and then reads
the block at the same position — turn into a cache hit rather than a second
request. Over a local file they are real syscalls; see [TODO.md](../TODO.md).

**Ask for one thing at a time.** jbrowse's record filter calls `getTag` rather
than reading `record.tags`, its render path reads `clipLengthAtStartOfRead`
rather than a packed CIGAR, and it builds a packed CIGAR only where a consumer
asks for the packed form, as a `Uint32Array` above 64 operations and a plain
array below. On a one-element payload, ~96 bytes of typed-array overhead costs
2.4x the memory and runs ~2x slower.

**Reuse the options object.** `forEachMismatch` takes its window as an object,
and a fresh literal per read per render pass measured 16.5 → 20.7 ms on 80,177
short reads. The library reads all three fields before the walk starts and
retains none of them, so one shared literal is safe.

**Gate the query on the index.** `bytesForRegions` sums `sliceBytes` from the
`.crai` to decide whether a region is too big to fetch, deduplicating slices
across regions first — adjacent regions routinely overlap one slice, which then
downloads once. The gate also limits the gains described above. A pileup capped
at 5 MB always stays in the 19–40 kb band, the shallow end of the pool's curve,
and that cap is most of why the end-to-end win there is ~1.1x while the decode
alone is 2.2x. The pool is worth much more to a whole-contig scan, an export or
a force-load.

## What we measured and rejected

[ADR 0007](adr/0007-optimizations-measured-and-rejected.md) keeps the list, with
the numbers: interning the decoded strings (real duplication, −6.5% retained,
and 10–20% of the decode to hash it), a positional `CramRecord` constructor,
coalescing single-base insertions at decode time, a short-buffer fast path in
`decodeUtf8`, hidden-class stability that was already stable. Read it before
proposing an optimization.

[TODO.md](../TODO.md) has the opposite list, of work measured, still open and
wanted, and a method note on how to A/B this repo without fooling yourself. Read
the note before adding anything to either list.
