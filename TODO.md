# TODO

Work that is measured, still open, and that we want to do. When an item is done
we remove it from this file, and if the decision behind it should be kept, it
goes to [docs/adr/](docs/adr/) instead.

Decisions already taken, including things measured and deliberately **not**
done, are recorded in [docs/adr/](docs/adr/). Read
[ADR 0007](docs/adr/0007-optimizations-measured-and-rejected.md) before
proposing an optimization, in case it has already been tried.

Numbers below were measured on this repo around v8.7.0, except the arena ones,
taken at v13.3.0 with `scripts/arena-columns.ts`. Read the method note at the
bottom before trusting or re-running them.

## Cache containers and compression schemes across queries

`getContainerAtPosition` and `getSlice` construct fresh objects on every call.
So even a query served entirely from `featureCache` re-reads the container
header and re-parses the compression header block, and reads each slice's bytes
again to get at its header. For a 6-slice warm query on SRR396637 that is 6
containers and 6 compression schemes, plus the slices' 2.5 MB. Locally that is
cheap. Over HTTP the byte-range cache answers the repeat reads, but the parse
still runs.

`getRecordsForRange` already shares containers across the slices of one query,
and `test/redundantReads.test.ts` checks that it does. Sharing them across
queries is still open, and it is **constrained, not merely unimplemented**. A
container's memos are threaded with the caller's `AbortSignal` on a
first-caller-wins basis, which is sound only while every caller of one memo
belongs to the same query. A file-level cache breaks that assumption and needs
the foreign-abort handling that `CramFile.featureCache` and `CraiIndex` have, so
read [ADR 0003](docs/adr/0003-abortsignal-on-the-read-path.md) before starting.

## Measure what a cancelled CRAM navigation abandons

The threading itself is **done on both sides**. This library has taken a
`signal` since v10 ([ADR 0003](docs/adr/0003-abortsignal-on-the-read-path.md)),
and jbrowse's `CramAdapter.getFeatures` now wraps its read in
`withStopTokenSignal` the way `BamAdapter` does, with a unit test that checks
the signal is threaded through and driven by that call's token.

The open work is measuring what a cancelled CRAM navigation gives up. The figure
quoted in the ADR is from the BAM path.

We considered a browser-level test and declined it. jest cannot cover what the
signal does to a socket. For BAM,
`products/jbrowse-web/browser-tests/suites/fetch-cancellation.ts` covers that
end and explains at length why jest cannot. A CRAM case there needs a pileup
deep enough to still be downloading after 2.5 s at 50 KB/s, and the only fixture
that qualifies is a ~9 MB binary. The CRAM case would exercise the same abort
machinery as the BAM case, so we judged the fixture not worth the repository
weight. Revisit if CRAM ever diverges from that path.

## Derive `refPos` rather than storing it

`scripts/arena-columns.ts` takes an arena apart; run it before touching this.
`refPos` is **834 KB on the ONT slice, 23.7% of the arena** now that
`payloadOffsets` is gone, and it is derivable: the decoder computes it as
`readPos + alignmentStart - 1 + refDelta`, where `refDelta` accumulates over a
record's features in order. That makes it the same kind of column as
`payloadOffsets` was, and
[ADR 0010](docs/adr/0010-checkpoint-the-payload-offsets.md) is the worked
example. Checkpoints every eighth slot took that column to an eighth of its
size, for −9.4% retained heap on ONT, with the accessors unchanged.

`refPos` is the **harder** case, though, for reasons other than size:

- Code reached `payloadOffsets` only through four accessors, so no code outside
  the arena saw the change. **`refPos` is a public column that consumers read
  directly**, and jbrowse destructures it in its walks. Deriving it means either
  keeping a column that is now a cache, or a breaking change.
- The derivation needs the record, not just the slot: `alignmentStart` is per
  record, and `refDelta` accumulates from that record's first feature. A
  checkpoint every eighth slot within one record works, but the arena would then
  need the record boundaries, which today are stored only on the records.

`pos` and `num` are the same 834 KB each and are **not** derivable, because
`pos` is the FP delta accumulated and `num` holds independent per-feature data.
With `payloadOffsets` gone those three are 71% of the arena, so `refPos` is the
last easy 24% of it.

We are not proposing to pack `refCodes`/`subCodes`. Together they are 417 KB
(11.8% of the arena) and would fit in the spare bits of an X feature's `num` (a
0–3 substitution-matrix index), but they are public columns, so packing them is
a breaking change that saves less than deriving `refPos`.

## Decide whether the worker pool should ever shut down

The worker pool never shuts down today. `destroySharedSliceWorkerPool()` is
exported and the library never calls it, so the first CRAM a page touches starts
four workers that live until the tab closes. With their wasm heaps at a 16 MB
floor each, that holds up to 80 MB and four threads after every CRAM track is
gone.

We already accepted the same argument for the record cache. `cacheIdleTimeoutMs`
exists precisely because "jbrowse's `CramAdapter` memoizes one `IndexedCramFile`
for the life of the track", and a parked tab should not hold its last view. The
pool is the larger number of the two and has no equivalent.

Shutting the pool down is still open because each choice has a real cost.
Teardown costs a worker spawn plus the wasm instantiation per worker on the next
query, ~5 ms each, and the pool is shared, so the next query to arrive pays for
everyone. "Idle" is also a coarser condition for the pool: the pool is per JS
context, so idle means no CRAM anywhere in the context has queried recently,
which one `CramFile` has no way to check. A `CramFile` that knows it is finished
can call `destroySharedSliceWorkerPool()` today, but only if it is the last one.

The pool section has no measurements yet. The 80 MB is arithmetic
(`docs/memory.md`), not an observation of a real page.

## Method note

Retained-heap figures come from decoding into a held variable in a **fresh
process per variant**, with a forced GC either side and no warm-up decode. A
discarded `await` at module top level stays reachable and is counted in the
baseline, which shrinks the measured delta to ~0 with no warning. Noise floor on
a base-vs-base control was ±0.2% for heap, ±1% for cold decode, ±8% for warm
re-query.

**The wall-clock claims here are untrustworthy**, because the machine was loaded
when these were taken, and the timing noise floor is wider than most of the
effects. Re-measure timings on a quiet machine before quoting any. Retained heap
reproduces to ±0.2% even on a loaded machine, so heap deltas in this file can be
taken at face value.

[docs/memory.md](docs/memory.md#measuring-it) describes two measuring errors
that give wrong numbers here: `heapUsed` not counting typed arrays, and A/B-ing
two source trees in one process. The same section lists the per-object costs (a
retained `Uint8Array` view is 104 B, a declared class field is 8 B) that most of
the items above rely on.

A usable A/B is one tree per process, alternating, comparing **fastest runs**
rather than medians, because contention shows up as occasional 2-3x outliers
that shift a median by 20% in either direction while the minimum stays the same.
Extract the baseline with `git archive <ref> | tar -x -C <dir>` and symlink
`node_modules` into it, so neither tree is a git worktree of the other.

Timing claims about long reads need a real long-read dataset, because the
checked-in ONT fixture is 37 records, too few to time stably. See
[ADR 0006](docs/adr/0006-cigar-as-a-callback-walk.md#evidence) for the corpus we
used and its results.
