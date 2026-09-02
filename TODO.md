# TODO

Work that is measured, still open, and that we want to do. Nothing here is done
— when an item lands it comes out of this file, and if the decision behind it is
worth keeping it goes to [docs/adr/](docs/adr/) instead.

Decisions already taken, including things measured and deliberately **not**
done, live in [docs/adr/](docs/adr/) — see
[ADR 0007](docs/adr/0007-optimizations-measured-and-rejected.md) before
proposing an optimization, in case it has already been tried.

Numbers below were measured on this repo around v8.7.0, except the arena ones,
taken at v13.3.0 with `scripts/arena-columns.ts`. Read the method note at the
bottom before trusting or re-running them.

## Cache containers and compression schemes across queries

`getContainerAtPosition` and `getSlice` construct fresh objects on every call.
So even a query served entirely from `featureCache` re-reads the container
header and re-parses the compression header block, and reads each slice's bytes
again to get at its header — for a 6-slice warm query on SRR396637 that is 6
containers and 6 compression schemes, plus the slices' 2.5 MB. Locally that is
cheap; over HTTP the byte-range cache absorbs the reads but the parse happens
regardless.

The within-a-query half is done — `getRecordsForRange` shares containers across
the slices of one query, pinned by `test/redundantReads.test.ts`. What is left
is the across-queries half, and it is **constrained, not merely unimplemented**:
a container's memos are threaded with the caller's `AbortSignal` on a
first-caller-wins basis, which is sound only while every caller of one memo
belongs to the same query. A file-level cache breaks that and needs the
foreign-abort handling `CramFile.featureCache` and `CraiIndex` have — read
[ADR 0003](docs/adr/0003-abortsignal-on-the-read-path.md) before starting.

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

## Derive `refPos` rather than storing it

`scripts/arena-columns.ts` takes an arena apart; run it before touching this.
`refPos` is **834 KB on the ONT slice, 23.7% of the arena** now that
`payloadOffsets` is gone, and it is derivable: the decoder computes it as
`readPos + alignmentStart - 1 + refDelta`, where `refDelta` accumulates over a
record's features in order. So it is the same shape as `payloadOffsets` was, and
[ADR 0010](docs/adr/0010-checkpoint-the-payload-offsets.md) is the worked
example — checkpoints every eighth slot took that column to an eighth of its
size, for −9.4% retained heap on ONT, with the accessors unchanged.

It is the **harder** case, though, and the reason is not size:

- `payloadOffsets` was reached only through four accessors, so nothing outside
  the arena could tell. **`refPos` is a public column that consumers read
  directly** — jbrowse destructures it in its own walks. Deriving it means
  either keeping a column that is now a cache, or a breaking change.
- The derivation needs the record, not just the slot: `alignmentStart` is per
  record, and `refDelta` accumulates from that record's first feature. A
  checkpoint every eighth slot within one record works, but the arena would have
  to know where records begin, which today only the records know.

`pos` and `num` are the same 834 KB each and are **not** derivable — `pos` is
the FP delta accumulated, and `num` is genuine per-feature data. With
`payloadOffsets` gone those three are 71% of the arena, so `refPos` is the last
easy 24% of it.

The neighbouring idea is **not** free and is not proposed: `refCodes`/`subCodes`
together are 417 KB (11.8% of the arena) and would fit in the spare bits of an X
feature's `num` (a 0–3 substitution-matrix index), but they are genuinely
public. Packing them is a breaking change for less than the above.

## Decide whether the worker pool should ever shut down

It does not today. `destroySharedSliceWorkerPool()` is exported and nothing
calls it internally, so the first CRAM a page touches starts four workers that
live until the tab closes — with their wasm heaps, a 16 MB floor each, so up to
80 MB and four threads held after every CRAM track is gone.

That is an asymmetry with the record cache, where the same argument was already
accepted: `cacheIdleTimeoutMs` exists precisely because "jbrowse's `CramAdapter`
memoizes one `IndexedCramFile` for the life of the track", and a parked tab
should not hold its last view. The pool is the larger number of the two and has
no equivalent.

It is left open rather than done because the trade is real in both directions.
Teardown costs a worker spawn plus the wasm instantiation per worker on the next
query — ~5 ms each, and the pool is shared, so the next query to arrive pays for
everyone. And "idle" is a coarser condition here: the pool is per JS context, so
it means no CRAM anywhere in the context has queried recently, which one file
cannot know. A `CramFile` that knows it is finished can call
`destroySharedSliceWorkerPool()` today, but only if it is the last one.

Nothing here is measured yet; the 80 MB is arithmetic (`docs/memory.md`), not an
observation of a real page.

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
up in [docs/memory.md](docs/memory.md#measuring-it), along with the per-object
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
