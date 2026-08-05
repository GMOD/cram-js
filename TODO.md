# TODO

Investigated, measured, not yet done. Numbers below were measured on this repo
at v8.7.0 — see the method note at the bottom before trusting or re-running
them.

Decisions that were _taken_ live in [docs/adr/](docs/adr/) rather than here;
this file is for what has been measured but not acted on, including what was
deliberately rejected.

## ~~Cached slices redo their reference decoration on every query~~ — done

`CramSlice.getRecords` used to serve records from `featureCache` and then
unconditionally recompute the reference regions, **re-issue every
`fetchReferenceSequenceCallback` call**, and re-run `addReferenceSequence` over
records that were already decorated. Five identical queries against a fully
cached file each re-fetched the same bases (ONT 310,089 ×5; Illumina 30,280 ×5),
and in jbrowse every one of those went through `CramAdapter.seqFetch` to the
sequence sub-adapter — so every pan back over cached data re-read reference it
already had.

Fixed by moving the decoration into `_fetchRecords`, the cached layer, so it
runs once per slice rather than once per query. `applyReferenceSequence` now
computes the span from **every** record in the slice rather than from one
query's matches, which is what makes it a property of the slice and so cacheable
— and is still the reads' extent, never the declared `refSeqSpan` (issue #79,
`test/seqfetch-bounds.test.ts`). Measured on SRR396637, 54,695 records:

```
cold   517 ms, 6 seqFetch calls, 100,684 bases
warm   5.5 ms, 0 seqFetch calls,       0 bases   (was: all 6 again, every query)
```

The md5 check no longer double-fetches either. It needs the slice's _declared_
reference span while decoration needs the reads' extent, so the two used to
issue separate calls for overlapping bases; the declared span covers every
mapped read in the slice by definition, so `checkReferenceMd5` now hands its
region back and decoration reuses it. `ce#5` with the check on went from 2
fetches to 1.

**The trade it makes**, which is the right one but worth knowing: resolving the
reference is now part of decoding a slice rather than something layered on
after. That is arguably the truer model — a CRAM record is reference-compressed,
so its bases do not exist without the reference — and it is what makes the
result cacheable. But it means a **failed `fetchReferenceSequence` now discards
the decode too**. `SliceRecordCache` drops rejected promises, so a flaky
sequence adapter costs a re-inflate of the slice on retry where before it only
cost the decoration. Worth revisiting only if that shows up in practice: the fix
would be to cache the decoded records and the reference resolution as separate
memos, which reintroduces most of the bookkeeping this removed.

## ~~`getReadBases()` costs ~1.5 ms per long read~~ — halved

`decodeReadSequence` concatenated a string, which on a long read meant a
`TextDecoder` call per insertion and soft clip (`payloadStringAt`), a
`String.fromCharCode` per substitution, a substring per reference chunk, and
finally a flatten of the whole rope when `toUpperCase` ran. 628 reads of
`200x.longread.cram` (median 49 kb, 3.1M read features, 31.1 Mbp) took ~960 ms.

Now assembled into a byte array and decoded once, with the upper-casing folded
into the copy and feature payloads copied straight out of the arena, which is
already bytes. Two trees, separate processes, fastest of seven:

| dataset       | records | HEAD    | now     |              |
| ------------- | ------- | ------- | ------- | ------------ |
| longread 200x | 628     | 862 ms  | 404 ms  | **-53%**     |
| SRR396637     | 54,695  | 29.0 ms | 25.6 ms | within noise |
| SRR396636     | 23,051  | 14.7 ms | 12.8 ms | within noise |

Byte-identical output on every record of all three.

**It only wins above a read length**, and loses badly below one — a typed-array
allocation plus a `TextDecoder` call per record is simply more than a substring
and a native `toUpperCase` for 100 bp: **+141%** on SRR396637 and **+253%** on
SRR396636 when the byte path ran unconditionally. Same trade as the read-feature
arena and the typed CIGAR. Hence `BYTEWISE_READ_BASES_MIN`, with the short-read
walk kept inline so the common case pays one comparison.

Two things this cost, recorded so they are not repeated:

- **`.toUpperCase()` was the wrong suspect.** It is 11 ms of the 960 — 1%. The
  reference is genuinely soft-masked (42,099 of the region's 85,377 bases are
  lowercase), so the upper-casing is needed; it was just never the cost.
- **Do not A/B a standalone copy of the old function against the new method.**
  Doing that reported +9-13% on short reads, which two-tree runs showed was
  entirely the harness: a free function in the benchmark inlines where the real
  `getReadBases` → `decodeReadSequence` path does not.

Reached from jbrowse via `feature.get('seq')` in the per-base-letter extractor,
so it is on the render path whenever per-base colouring is on, and via
`toJSON()` for the details panel.

The related `NUMERIC_QUAL` path is **not** a comparable problem, despite looking
like one: `CramRecord.qualityScores` returns a `subarray` view over the slice's
quality column, so it is ~104 bytes and no copy, not an O(readLength)
materialization. Handing out `qualityColumn`/`qualityStart` instead would save
that one view per read and nothing more.

## Every warm query rebuilds the container and re-parses its compression scheme

`getContainerAtPosition` and `getSlice` construct fresh objects on every call —
see the `// TODO: perhaps we should cache slices?` in `container/index.ts`. So
even a query served entirely from `featureCache` re-reads the container header
and the slice header and re-parses the compression header block: 36 filehandle
reads, 6 containers and 6 compression schemes for a 6-slice warm query on
SRR396637. Locally that is a couple of KB; over HTTP it is 6 range requests per
slice per query, and the parse happens regardless of what the byte-range cache
does.

Files with more than one slice per container duplicate it _within_ a query too —
every slice builds its own `CramContainer` and re-inflates the same compression
header. The fixtures here are all 1 slice per container, so that case is
un-measured; htsjdk output is where to look.

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

- The `bind()` closures in `slice/decodeContext.ts` are a fourth copy of the
  External/ByteArrayStop/ByteArrayLength decode logic, bounds checks included. A
  `CramCodec.bindDecoder(coreDataBlock, blocksByContentId, cursors)` returning a
  specialised closure (defaulting to `() => this.decode(...)`) would let each
  codec own its fast path and drop the `instanceof` chain.
- The self-clearing async memoize block is copy-pasted seven times across
  `file.ts`, `container/index.ts` and `slice/index.ts`.
- `slice/index.ts` builds its reference regions in a `Record<string, …>` keyed
  by numeric seq ids, then re-keys them into a second `Record` and looks each up
  again per record. A `Map<number, …>` collapses it, and the single-reference
  case — the common one — has exactly one region and needs no map at all.
- `readFeatureArena.ts`'s `growUint8`/`nextCapacity` and `qualityColumn.ts`'s
  inline grow loop are the same geometric-growth-then-trim, written twice.
- `sectionParsers.ts` has ~40 sites of
  `const [v, newOffsetN] = parseItf8(buffer, offset); offset += newOffsetN`,
  with `newOffset1..8` numbered inconsistently against the fields they belong
  to. A small reader over `(buffer, offset)` with `.itf8()`/`.ltf8()`/`.u8()`/
  `.u32()` would roughly halve the file.
- The read-features-to-mismatches walk exists twice:
  `src/cramFile/mismatches.ts` here and
  `plugins/alignments/src/CramAdapter/readFeaturesToMismatches.ts` in jbrowse,
  which does not use ours. They are the same walk and disagree in details —
  soft-clip `length` 0 against 1, deletion `bases` `''` against `'*'`, a closed
  window against a half-open one. Either jbrowse adopts `forEachMismatch` or
  this repo is carrying a second, unexercised copy of its own trickiest walk.

  The read-features-to-CIGAR walk had the same split and no longer does:
  `CramRecord.forEachCigarOp` is now the primitive `getCigarString` renders, and
  jbrowse's `readFeaturesToNumericCIGAR` packs its array from it rather than
  re-walking the arena. Note what made that one tractable: the CIGAR has a
  single spec-defined vocabulary (the SAM op codes), so the walk could be moved
  in here without dragging any consumer's render types along. The mismatch walk
  emits jbrowse's own vocabulary, which is exactly why it has not moved — see
  the note under "Packing the arena's columns".

## What `forEachCigarOp` costs, and why it was taken anyway

The CIGAR walk moved here from jbrowse's `readFeaturesToNumericCIGAR` as a
callback rather than as an array, because CRAM stores no CIGAR — unlike BAM,
where the packed array is on disk and `@gmod/bam` can hand out a zero-copy view
of it, any array form here is an allocation this library would have invented and
imposed on every consumer.

**It is measurably slower than the inlined walk it replaced.** A/B over decoded
records, alternating, fastest-of-N, with an A-vs-A control to establish the
noise floor, three processes each:

| dataset           | records | ops       | control      | via `forEachCigarOp` |
| ----------------- | ------- | --------- | ------------ | -------------------- |
| longread 200x     | 628     | 4,452,662 | -1.4%..+1.4% | **+13.5%..+17.5%**   |
| SRR396637         | 54,695  | 69,837    | -0.8%..+2.8% | **+8.9%..+15.5%**    |
| SRR396636         | 23,051  | 33,793    | -0.6%..+5.1% | **+12.6%..+20.3%**   |
| ONT HG002 fixture | 37      | 244,795   | -1.2%..+2.1% | +10.9%..+13.8%       |

Call it **~15%** of the CIGAR-building step, and note it is ~15% at both ends of
the read-length range rather than concentrated at one — long reads pay it per
operation, short reads per call, and the two land in the same place. In absolute
terms it is ~10 ms on a ~70 ms pass over 628 long reads (~16 µs per read, which
jbrowse then memoizes per feature in its ultra-long LRU), and ~0.5 ms on a 3.5
ms pass over 54,695 short ones.

### Do not measure this with two consumers in one process

The first version of this benchmark ran `packCigar` **and** a hoisted-callback
variant in the same process, and reported **+40%..+60%**. That was an artefact:
two consumers make `forEachCigarOp`'s internal `callback(op, oplen)` sites
polymorphic and block inlining. With a single consumer — what jbrowse actually
has — the cost is the ~15% above.

Which is also a real constraint on the API, not just on the benchmark: **the
cost of this callback is not local**. A second call site in the same process
with a differently-shaped callback roughly triples the penalty for the first. If
a consumer ever wants both a packer and, say, a clip-length walker, they should
share one callback rather than pass two.

Two things were tried and did **not** recover it:

- **Inlining the run coalescing** instead of factoring it into a `push(len, op)`
  closure. This one is worth keeping and is what the code does now: the closure
  has to capture and mutate `op`/`oplen`, so V8 allocates a context per call,
  which cost a further +40% on the short-read files (1.3 ops per record, so
  per-call cost dominates) and +10% on the long-read ones.
- **Hoisting the consumer's callback** to a module-level singleton writing into
  a swapped-in target array, so nothing is allocated per record. Measured
  indistinguishable from the per-call arrow. The remaining cost is the indirect
  call per operation, not allocation — so there is no consumer-side trick that
  gets it back, and a packed-array API would be the only way.

Taken anyway: it deletes a 240-line second implementation of the format's
trickiest walk, one that had no samtools cross-check on the side that shipped
it. Revisit only with an end-to-end jbrowse render measurement showing it
matters there — this micro-benchmark deliberately isolates the walk from
everything else a render does per read.

### …and then the render path stopped building a CIGAR at all

The ~15% above is what it costs to _build the packed array_. It turned out the
render path never needed the array: `clipLengthAtStartOfRead` is the only CIGAR
value it reads per read, and that is a single operation — the first, or the last
on the reverse strand. jbrowse was manufacturing ~7,000 operations for a long
ONT read, and retaining them, to look at one.

{@link CramRecord.getLeadingClipLength} answers the forward-strand case in O(1)
by reading the features at the start of the record, so with jbrowse computing
the clip from that (and from an allocation-free walk on the reverse strand, ~50%
of reads) the whole step is now **faster than the array version it replaced**:

| dataset       | records | vs. building the array |
| ------------- | ------- | ---------------------- |
| longread 200x | 628     | **-62%**               |
| ONT HG002     | 37      | **-62%**               |
| SRR396637     | 54,695  | **-45%**               |
| SRR396636     | 23,051  | **-46%**               |

Identical answers on every record of every dataset, control within ±3%. So the
callback's ~15% is paid only by consumers that genuinely want the packed form
(per-base colouring, the details panel), and `NUMERIC_CIGAR` is now lazy for
CRAM rather than built once per read on the render path.

Both ends are now O(1). `getTrailingClipLength()` looked impossible at first —
whether a trailing clip is really the last _operation_ turns on whether read
bases follow it, which is the read bases every earlier operation consumed, which
looks like the whole walk. It is not: the walk reaches each feature having
emitted exactly `pos[i]` read bases, so the total is `pos[last]` plus whatever
the last feature consumes. That identity was checked against the walk over
~82,000 records across every fixture plus 628 long reads, 13,586 of them
trailing-clipped, and `hard_clipping.cram` — the fixture originally cited as the
counterexample — is among them.

With both ends direct, the whole step all but disappears: **-99.9%** on the
long-read set (148 ms to ~0.15 ms for 628 reads) and **-64%** on the short-read
files, against building the packed array to read one element of it.

### Use a real long-read dataset for this

The checked-in ONT fixture is **37 records**, which is too few to time stably —
its control swung 23 points before the polymorphism was fixed. `~/src/jb2bench`
has `200x.longread.cram` (36 MB, hg19mod.fa alongside it); the region
`0..120000` gives 628 records, 3.1M read features, 4.45M CIGAR ops and a median
read length of 49 kb, and its control holds to ±1.4%. Too big to check in here,
but that is the shape of data any claim about long-read CIGAR cost needs.

It is worth as much for correctness as for timing: the benchmark compares the
two walks op-for-op before it times anything, and over those 4.45M operations
they agree **exactly**, with no unmapped reads in the region to hit the one
intended difference below. That is a far wider cross-check of the walk than the
checked-in fixtures reach.

### It also changed the CIGAR of unmapped reads

`forEachCigarOp` emits nothing for an unmapped read, so jbrowse's
`NUMERIC_CIGAR` is now empty for one where the walk it replaced synthesized a
full-length match run (190 of the ONT fixture's records, 114 of SRR396637's).
Empty is right: `getCigarString()` gives `'*'`, which is what samtools prints,
and `@gmod/bam`'s `_computeNumericCigar` likewise returns an empty `Uint32Array`
for `BAM_FUNMAP` — so this makes jbrowse's CRAM path agree with its BAM path
rather than diverge from it.

## Measured and _not_ worth doing

Recorded so they are not rediscovered:

- **Deferring the read name behind a getter.** Attractive for a real reason — a
  plain jbrowse pileup render never asks for a read name — but the batching took
  names from ~10.4 ms to ~1.5 ms first, so deferral is left competing for ~1.4%
  of the decode and would buy it with a public field's field-ness. The call
  sites, the numbers and the general point (check whether a per-record cost
  wants to be _batched_ before deciding it wants to be deferred) are in
  [ADR 0002](docs/adr/0002-batch-decoding-over-lazy-fields.md).

- **Interning the decoded strings.** Tried, measured, reverted. The duplication
  is real and large — SRR396637 has 164,526 tag values with only **1,084
  distinct** ones (`MC` is a CIGAR string repeated across nearly every record),
  and 27,462 distinct read names for 54,695 records, because the two mates of a
  pair share one. A per-slice `Map<string, string>` in `bindStringReader`
  delivers on the memory exactly as expected:

  | dataset   | retained, sharing | retained, interned   |
  | --------- | ----------------- | -------------------- |
  | SRR396637 | 31.55 MB          | **29.49 MB** (-6.5%) |
  | SRR396636 | 13.27 MB          | **12.48 MB** (-6.0%) |
  | ONT       | 7.47 MB           | 7.47 MB (37 records) |

  That is not only better than the un-interned reader, it is 1.19 MB _below_
  where the file sat before any of the batching work.

  **It costs 10-20% of the decode**, which is far more than the memory is worth
  on a path whose whole point was speed. Against 7023d88, 12 paired rounds with
  an A-vs-A control: SRR396637 -15.5% mean, faster in **0/12** (control -2.9%,
  5/12); jb2bench 200x -10.9%, 2/12 (control +2.1%); jb2bench 1000x -20.6%, 1/12
  (control -4.6%). ONT reads +15.8% but its control reads +13.3%, so it is
  drift, not an effect.

  The reason is that a `Map` keyed by string has to **hash the string**, which
  means reading every character of it — ~220,000 times per decode of SRR396637,
  on values that had just been made nearly free to produce. Deduplication that
  needs to look at the bytes cannot be cheaper than producing the bytes.

  Two things it also does _not_ do, contrary to the note that used to be here:
  it does not let the decoded block be collected, because interning keeps one
  reference per distinct value and one reference pins the block just as well as
  fifty thousand; and it does not remove the temporary, which is allocated to be
  hashed whether or not it is kept.

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

## Packing the arena's columns

On the ONT slice `payloadOffsets` is 854 KB (11.5% of the 7.42 MB the records
retain) and `refCodes`/`subCodes` together are 427 KB (5.7%). Offsets are
monotonic, so a per-record base offset would collapse them; and an X feature's
`num` only holds a 0–3 substitution-matrix index, so `ref`/`sub` would fit in
its spare bits.

The two halves are **not** equally locked, contrary to what this section used to
say. Auditing what jbrowse actually reads: `readFeaturesToMismatches` and
`readFeaturesToNumericCIGAR` destructure `codes`, `pos`, `refPos`, `num`,
`refCodes`, `subCodes` and call `payloadStringAt(i)`. Neither ever touches
`payloadOffsets` or `payloadBytes`.

- **`payloadOffsets` is free to pack or privatise.** It is 11.5% of an ONT slice
  and no consumer reads it. The only cost is that `payloadBytesAt` /
  `payloadStringAt` have to unpack, which is where the reads already go.
- **`refCodes`/`subCodes` are genuinely public.** That walk is on jbrowse's
  render path and emits jbrowse's own mismatch vocabulary, so it cannot move in
  here; packing them is a breaking change for 5.7%. Privatising the layout would
  mean cram-js owning that walk too, which would drag `@jbrowse/cigar-utils`'
  render types into a file parser.

## Short-read record memory — what is left after the quality column

The read-feature arena and the quality column between them cover the two ends of
the read-length range. What remains is the per-record JS object graph, which is
what dominates short-read files. Ablation on SRR396637 (54,695 records) after
the quality column landed, freeing one field at a time and re-measuring:

| component          | freed     | B/record |
| ------------------ | --------- | -------- |
| CramRecord shells  | 12,697 KB | 238      |
| `mate`             | 4,682 KB  | 88       |
| `tags`             | 4,284 KB  | 80       |
| `readName`         | 3,349 KB  | 63       |
| `readFeatureArena` | 2,327 KB  | 44       |
| `_refRegion`       | 333 KB    | 6        |

The `readName` row has since shrunk by ~2 MB — names are decoded during the
slice decode now, which dropped the per-record `Uint8Array` view, two of the
three name fields, and a duplicate string per detached record. The shape of the
rest of the table still holds.

It then grew back by ~0.69 MB when the names started being decoded a block at a
time (`bindStringReader`). A name is now a `slice` of the one decoded block, so
54,695 of them are ~1.31 MB of 24-byte slice headers plus the 1.14 MB block they
point into, against ~1.75 MB of standalone strings before — and **a slice keeps
its whole name block alive as long as any record from it lives**. That was taken
knowingly for the decode time; interning is what would recover it, see below.

Per-object costs measured on this V8 (Node 24, 200k instances each): a retained
`Uint8Array` view is **104 B**, an empty `{}` is **56 B**, a 25-char string is
**56 B**, and a declared class field is **8 B** — so every field removed from
`CramRecord` is 437 KB on a 54k-record view. Ranked by what looks reachable:

- **Share one frozen empty `tags`.** A fresh `{}` per record is 56 B whether or
  not it holds anything, so `decodeTags: false` still pays ~3.0 MB of the 4.28
  MB that tags cost. Worth it for that mode and for tagless files.
- **Flatten `mate`.** 88 B/record with every record in these files carrying one.
  Four inlined fields (32 B) plus a `mate` getter that rebuilds the object would
  save ~50 B/record, but jbrowse reads `record.mate.*` three or four times per
  feature in its getters, so it needs `mateStart`/`mateSequenceId` handed to it
  directly rather than an allocating getter. Breaking; needs an API decision.

## Method note

Retained-heap figures come from decoding into a held variable in a **fresh
process per variant**, with a forced GC either side and no warm-up decode (a
discarded `await` at module top level stays reachable and lands in the baseline,
which silently collapses the measured delta to ~0). Noise floor on a
base-vs-base control was ±0.2% for heap, ±1% for cold decode, ±8% for warm
re-query.

**No wall-clock claim here is trustworthy** — the machine was loaded when these
were taken, and the timing noise floor is wider than most of the effects.
Re-measure timings on a quiet machine before quoting any. Retained heap is the
opposite: it reproduces to ±0.2% even on a loaded machine, so heap deltas in
this file can be taken at face value.

The two traps that produce confidently wrong numbers here — `heapUsed` not
seeing typed arrays, and A/B-ing two source trees in one process — are written
up in [docs/MEMORY.md](docs/MEMORY.md#measuring-it), along with the per-object
costs (a retained `Uint8Array` view is 104 B, a declared class field is 8 B)
that most of the items above are reasoning from.

A usable A/B is one tree per process, alternating, comparing **fastest runs**
rather than medians: contention shows up as occasional 2-3x outliers that drag a
median around by 20% in either direction, while the minimum stays put. Extract
the baseline with `git archive <ref> | tar -x -C <dir>` and symlink
`node_modules` into it, so neither tree is a git worktree of the other.
