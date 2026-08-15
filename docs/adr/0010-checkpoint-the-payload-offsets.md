# 0010 — Checkpoint the payload offsets rather than storing one per slot

**Status:** accepted

## Context

`ReadFeatureArena` stored a `payloadOffsets: Int32Array` with one entry per read
feature, pointing at that feature's bytes in `payloadBytes`. Measured with
`scripts/arena-columns.ts`, three things were true of it and none were on
record:

- **834 KB on the ONT slice**, 19.6% of the arena and 11.5% of the 7.10 MB the
  records retain.
- **Three quarters of it indexed nothing.** Only 53,292 of that slice's 213,602
  features carry bytes at all — 13.9% on SRR396637, where features are nearly
  all `X` — so the rest held a zero no accessor may read.
- **It was 2.9x the size of the data it indexed**: 834 KB of offsets over 291 KB
  of `payloadBytes`.

It was also pure redundancy. Payloads are appended in slot order, and a slot's
length is already on the record — `num` for I/S/b/i/q, one byte for B, zero
otherwise — so the offsets are a running prefix sum. Checked over every slot of
all three performance fixtures: **0 deviations**.

So the column bought exactly one thing, O(1) random access, and
[TODO.md](../../TODO.md) was wrong to call replacing it "free": the accessors
that read it take an index and nothing else, and `ReadFeatureArena` is exported.

## Decision

Keep an offset for every **eighth** slot — `payloadChunks` — and derive the rest
by walking forward from the nearest one. `payloadOffsetAt` bounds that at seven
steps, and the four payload accessors keep their signatures, so nothing outside
the arena changes.

Three details make it hold:

- **The checkpoints are built in `trim()`**, in one pass, rather than maintained
  as payloads are appended. A slice decodes once and its columns are final only
  when it finishes, which is the only point where every slot's code and `num`
  can be read. `indexedLength` records what they were built for, so an arena
  read while still being filled rebuilds rather than answering stale — a
  hand-built arena behaves like a decoded one.
- **A sequential walk carries the offset itself** instead of calling
  `payloadOffsetAt` per feature. `decodeReadSequenceBytes` and `forEachMismatch`
  both do; on a long read the insertions the latter emits are most of the
  features it visits, so it would otherwise pay the scan repeatedly over a
  single forward pass. The advance sits outside each walk's `RF_POSITIONAL`
  test, because a `q` feature carries bytes while emitting nothing and skipping
  it desynchronises every payload after it.
- **`RF_PAYLOAD` is the one table** both the arena and the walks read, with its
  values chosen so `kind === PAYLOAD_NUM ? num[i] : kind` is the length. One
  place to be wrong about what a code carries, rather than four.

## Consequences

- The arena is 4254 KB → **3524 KB** on the ONT slice. Retained heap 7.53 →
  **6.82 MB** (−9.4%), and 27.41 → **27.05 MB** (−1.3%) on SRR396637, where
  there are few payload-bearing features to index in the first place. This is a
  long-read win; short-read files barely move.
- **`payloadOffsets` is gone from a public class.** No consumer read it — the
  audit behind the old TODO item established that jbrowse destructures `codes`,
  `pos`, `refPos`, `num`, `refCodes`, `subCodes` and otherwise goes through the
  accessors — but it is a breaking change on paper.
- Random access is no longer O(1). Seven steps is the worst case and the
  accessors hide it, but a caller walking a whole record in order should carry
  the offset rather than call per feature, and the two internal walks show how.
- The transfer shrinks by the same column, since `sliceTransfer` sends
  `payloadChunks` in its place.
- **The same argument now applies to `refPos`**, which is another 834 KB
  derivable from `pos` plus a running per-record delta. It is not done, and it
  is a harder case: `refPos` is read directly by consumers, where
  `payloadOffsets` never was.

## Evidence

Memory, from `scripts/arena-columns.ts` and `scripts/measure-heap.ts`, which
reproduce to ±0.2% — the figures above.

Correctness, which is what this change actually risks: sha256 over `toJSON()`,
`getCigarString()`, `getPairOrientation()`, `getReadBases()`, `readFeatures` and
`getMismatches()` for **all 91,413 records across all 51 indexed fixtures**
matches `origin/main` exactly, both after the arena change and again after the
mismatch walk was rewritten to carry its own offset. The full suite passes
unchanged, including the 189 snapshots.

**Wall-clock is deliberately not quoted here.** The machine was loaded while
this was written, and [TODO.md](../../TODO.md)'s method note is explicit that
timings taken on one are not trustworthy — an in-process branch-vs-branch run
put the long-read mismatch walk at 2.66x _faster_, which is not a real effect
and is the trap `docs/memory.md` describes under "do not A/B two source trees in
one process". `benchmarks/reads.bench.ts` was added to settle it on a quiet
machine; it covers the walks that happen after a decode, which
`benchmarks/cram.bench.ts` never reached.

What can be said without a timer: the decode does strictly less work than before
(an offset write per payload became one indexing pass per slice), and both
sequential walks do the same number of array reads per feature as they did with
the full column.
