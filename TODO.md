# TODO

Work that is measured, still open, and that we want to do. Nothing here is done
— when an item lands it comes out of this file, and if the decision behind it is
worth keeping it goes to [docs/adr/](docs/adr/) instead.

Decisions already taken, including things measured and deliberately **not**
done, live in [docs/adr/](docs/adr/) — see
[ADR 0007](docs/adr/0007-optimizations-measured-and-rejected.md) before
proposing an optimization, in case it has already been tried.

Numbers below were measured on this repo around v8.7.0. Read the method note at
the bottom before trusting or re-running them.

## Cache containers and compression schemes across queries

`getContainerAtPosition` and `getSlice` construct fresh objects on every call —
see the `// TODO: perhaps we should cache slices?` in `container/index.ts`. So
even a query served entirely from `featureCache` re-reads the container header
and the slice header and re-parses the compression header block: 36 filehandle
reads, 6 containers and 6 compression schemes for a 6-slice warm query on
SRR396637. Locally that is a couple of KB; over HTTP the parse happens
regardless of what the byte-range cache does.

The within-a-query half is done — `getRecordsForRange` shares containers across
the slices of one query, pinned by `test/redundantReads.test.ts`. What is left
is the across-queries half, and it is **constrained, not merely unimplemented**:
a container's memos are threaded with the caller's `AbortSignal` on a
first-caller-wins basis, which is sound only while every caller of one memo
belongs to the same query. A file-level cache breaks that and needs the
foreign-abort handling `SliceRecordCache` and `CraiIndex` have — read
[ADR 0003](docs/adr/0003-abortsignal-on-the-read-path.md) before starting.

## `readBlock` reads the same offset twice

`readBlock` reads `cramBlockHeader.maxLength` at a position, then reads the full
block at the same position — the second read is a superset of the first. Per
cold decode: 2 of 8 filehandle reads on ONT, 6 of 22 on Illumina are redundant
(~25%), but only ~34–102 redundant _bytes_. On `ce#1000.tmp.cram` it is the only
remaining redundancy: a whole-reference query issues 545 reads at 373 distinct
positions, so 172 of them are this.

It is **not** 25% more range requests over HTTP, which an earlier version of
this note guessed. jbrowse's `RemoteFileWithRangeCache` caches per 256 KiB
chunk, and the probe and the full read are in the same chunk by construction, so
the second one is a cache hit. What it costs there is a `Uint8Array` allocation,
a copy and a synthesized `Response` per read. Locally it is a real
`open`/`read`/`close`, since that is what `LocalFile.read` does per call.

So: worth doing, but as an allocation/syscall win, not a network one. Measured
at the CramFile→filehandle boundary.

## Measure what a cancelled CRAM navigation abandons

The threading itself is **done on both sides**. This library has taken a
`signal` since v10 ([ADR 0003](docs/adr/0003-abortsignal-on-the-read-path.md)),
and jbrowse's `CramAdapter.getFeatures` now wraps its read in
`withStopTokenSignal` the way `BamAdapter` does, with a unit test pinning that
the signal is threaded and driven by that call's token.

What is left is the measurement: nobody has established what a cancelled CRAM
navigation actually gives up. The figure quoted in the ADR is from the BAM path.

A browser-level case was considered and declined. jest cannot cover what the
signal does to a socket —
`products/jbrowse-web/browser-tests/suites/fetch-cancellation.ts` covers that
end for BAM and explains at length why — but a CRAM case there needs a pileup
deep enough to still be downloading after 2.5 s at 50 KB/s, and the only fixture
that qualifies is a ~9 MB binary. The abort machinery under test is shared with
the BAM case, so the fixture was judged not worth the repository weight. Revisit
if CRAM ever diverges from that path.

## Pack or privatise `payloadOffsets`

On the ONT slice `payloadOffsets` is 854 KB, **11.5%** of the 7.42 MB the
records retain, and the offsets are monotonic — a per-record base offset would
collapse them. Auditing what the render path actually reads: the mismatch walk
(now this repo's own `forEachMismatch`, since jbrowse deleted its copy) and
jbrowse's `readFeaturesToNumericCIGAR` destructure `codes`, `pos`, `refPos`,
`num`, `refCodes`, `subCodes` and call `payloadStringAt(i)`. **Neither ever
touches `payloadOffsets` or `payloadBytes`**, so this is free to change: the
only cost is that `payloadBytesAt` / `payloadStringAt` have to unpack, which is
where the reads already go.

The neighbouring idea is **not** free and is not proposed: `refCodes`/`subCodes`
together are 427 KB (5.7%) and would fit in the spare bits of an X feature's
`num` (a 0–3 substitution-matrix index), but they are genuinely public. Packing
them is a breaking change for 5.7%.

The obstacle that used to be listed here — that privatising the layout would
mean cram-js owning the mismatch walk — is gone: it owns it now, since jbrowse
deleted its copy and drives `forEachMismatch`
([ADR 0008](docs/adr/0008-emit-into-the-consumers-callback.md)). What is left is
the plain compatibility argument, `readFeatures` being reachable by anyone.

## Simplifications (no perf angle)

- `growUint8`/`growInt32`/`nextCapacity` in `readFeatureArena.ts`, the same
  helpers in `tagColumn.ts`, and `qualityColumn.ts`'s inline grow loop are the
  same geometric-growth-then-trim written three times.

- `CramRecord`'s constructor parameter is `ReturnType<typeof decodeRecord>`, so
  every key is required and building a record by hand means spelling out seven
  explicit `undefined`s (see `test/pairOrientation.test.ts`). A named
  `CramRecordArgs` interface with the optional fields marked optional fixes that
  at no runtime cost. Do **not** take the other option and make the constructor
  positional — that was measured and rejected, see
  [ADR 0007](docs/adr/0007-optimizations-measured-and-rejected.md).

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

Timing claims about long reads need a real long-read dataset — the checked-in
ONT fixture is 37 records, too few to time stably. See
[ADR 0006](docs/adr/0006-cigar-as-a-callback-walk.md#evidence) for the corpus
that was used and what it gives.
