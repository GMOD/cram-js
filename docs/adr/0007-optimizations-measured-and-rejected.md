# 0007 — Optimizations measured and rejected

**Status:** accepted

## Context

One record for a family of decisions rather than one each, because they were all
settled the same way — someone looked at the decode, saw an obvious waste,
measured it, and found the waste was not where it looked. Kept together because
what makes them worth reading is the pattern, and because each on its own is a
paragraph.

Two lessons recur, and both are the reason these are recorded rather than
quietly dropped:

- **A fixed per-record cost is not free just because it is small.** Typed
  arrays, `TextDecoder` calls and object allocations all have a fixed overhead
  that a 100 bp short read cannot amortize and a 49 kb long read never notices.
  Every item below that failed, failed on short reads.
- **Deduplication that has to look at the bytes cannot be cheaper than producing
  the bytes.** This is the whole of the interning result.

## Decision

None of the following are done, and none should be reopened without evidence
that contradicts the numbers under **Evidence**:

- Interning the decoded strings.
- A positional `CramRecord` constructor.
- Coalescing consecutive single-base `i` insertions at decode time.
- Shrinking `batchDecodeItf8`'s scratch buffer.
- A short-buffer fast path in `decodeUtf8`.
- "Fixing" `CramRecord`'s conditional constructor assignments for hidden-class
  stability — there is nothing to fix, and the fix would be a pessimisation to
  guard against.
- Reshaping read features to make consumer call sites monomorphic.
- Building a `Uint32Array` CIGAR for every read regardless of length.

Deferring the read name behind a getter was rejected too; it has its own record
in [ADR 0002](0002-batch-decoding-over-lazy-fields.md), because the reason it
lost — it was competing for ~1.4% of the decode after batching had already taken
names from ~10.4 ms to ~1.5 ms — is that ADR's point.

## Consequences

The costs these would have removed are still being paid, and two are worth
naming so they are not mistaken for oversights:

- **A slice keeps its whole decoded name block alive as long as any record from
  it lives.** Interning is what would recover that; see ADR 0002's consequences
  for the trade as it stands.
- **Consumers coalesce runs of single-base insertions themselves**, in their own
  walks, as htslib does.

## Evidence

Method throughout: one source tree per process, alternating, comparing fastest
runs rather than medians, with an A-vs-A control to establish the noise floor.
The traps that make this necessary are in
[docs/MEMORY.md](../MEMORY.md#measuring-it).

### Interning the decoded strings

Tried, measured, reverted. **The duplication is real and large** — SRR396637 has
164,526 tag values with only **1,084 distinct** ones (`MC` is a CIGAR string
repeated across nearly every record), and 27,462 distinct read names for 54,695
records, because the two mates of a pair share one. A per-slice
`Map<string, string>` in `bindStringReader` delivers on the memory exactly as
expected:

| dataset   | retained, sharing | retained, interned   |
| --------- | ----------------- | -------------------- |
| SRR396637 | 31.55 MB          | **29.49 MB** (-6.5%) |
| SRR396636 | 13.27 MB          | **12.48 MB** (-6.0%) |
| ONT       | 7.47 MB           | 7.47 MB (37 records) |

That is not only better than the un-interned reader, it is 1.19 MB _below_ where
the file sat before any of the batching work.

**It costs 10-20% of the decode**, far more than the memory is worth on a path
whose whole point was speed. Against 7023d88, 12 paired rounds with an A-vs-A
control: SRR396637 -15.5% mean, faster in **0/12** (control -2.9%, 5/12);
jb2bench 200x -10.9%, 2/12 (control +2.1%); jb2bench 1000x -20.6%, 1/12 (control
-4.6%). ONT reads +15.8% but its control reads +13.3%, so that is drift, not an
effect.

The reason is that a `Map` keyed by string has to **hash the string**, which
means reading every character of it — ~220,000 times per decode of SRR396637, on
values that had just been made nearly free to produce.

Two things interning also does _not_ do, contrary to the note that used to claim
them: it does not let the decoded block be collected, because interning keeps
one reference per distinct value and one reference pins the block just as well
as fifty thousand; and it does not remove the temporary, which is allocated to
be hashed whether or not it is kept.

### A positional `CramRecord` constructor

`decodeRecord` builds a 19-key object literal that `new CramRecord(...)`
immediately destructures and drops, one per record — so on the
per-record-and-GC-bound short-read path it looks like free throughput. Having
`decodeRecord` return the `CramRecord` directly, through a 19-argument
positional constructor, does remove the allocation, and the output is
byte-identical (sha256 over `toJSON()` + `getCigarString()` +
`getPairOrientation()` for all 92,582 records in `test/data`).

It buys nothing worth having: five alternating processes per tree,
median-of-medians, gave 129.6 → 128.5 ms on SRR396637 and 56.2 → 56.0 ms on
SRR396636, both inside the ±1% cold-decode noise floor. GC time does drop
consistently (107 → 94 ms on SRR396637, ~12%), confirming the allocation really
is gone, but GC is only ~8% of that decode so it never reaches 1% end to end.

Against that: nineteen unlabelled positional parameters, sixteen of them
`number` or `number | undefined`, where any transposition still typechecks — and
it is a breaking change to a public constructor. The constructor does have a
type wart worth fixing on its own terms, which is a different change and is in
`TODO.md`.

### Coalescing consecutive single-base `i` insertions

The claim was that 34,387 of the ONT fixture's 213,602 features (16%) are
single-base insertions "that both jbrowse consumers immediately re-coalesce into
runs". They are single-base insertions, but they are _isolated_: counting
adjacent `(i, i)` slot pairs — exactly the pair a consumer merges, since two
adjacent `i` features share a reference position if and only if their read
positions are adjacent — gives **0 runs on ONT, 0 on SRR396636, 0 on
SRR396637**.

So coalescing at decode time bought nothing on all three, in exchange for a
per-feature branch in the decode loop and a change to a public output shape (it
altered exactly one of the 189 snapshots, the grc37-1 Illumina one). htslib does
not merge the features either — its `case 'i'` accumulates into the _CIGAR_ via
`cig_len++` while keeping one decode step per feature (`cram/cram_decode.c`).

### `batchDecodeItf8` scratch sizing

The `new Int32Array(buffer.length)` looks like a 4x over-allocation. Measured
utilisation is **97.5–100%** — ITF8 values in these blocks are overwhelmingly
single-byte — and the `.slice()` copy path fires on 0.15 MB of 14.70 MB.

### A short-buffer fast path in `decodeUtf8`

Node 24's `TextDecoder` matches or beats `String.fromCharCode.apply` at every
length tested (73–114 ns/call against 62–147), and is 2x faster at length 12.

### `CramRecord` hidden-class stability

The conditional constructor assignments look like they would split the hidden
class. Measured **1 shape** across all records, because `target: es2022` implies
`useDefineForClassFields`. Note that lowering the compile target would silently
undo this.

### Read-feature polymorphism as a consumer cost

Forcing true monomorphism made jbrowse's two walks no faster — noise in both
directions. Moving `ref`/`sub` into the arena's byte columns was worth doing for
its _memory_, not for call-site shape.

### A `Uint32Array` CIGAR for every read

In jbrowse's `readFeaturesToNumericCIGAR` the typed array is 8.7% faster and
half the retained bytes on ONT (median 4391 ops/read), but **147% slower and
2.4x the memory** on short reads (median 1 op/read), where ~96 bytes of fixed
typed-array overhead lands on a one-element payload. Same shape of trap as the
per-record arena. That walk switches per read at 64 ops, matching the ~50–100
crossover bam-js measured in its own `src/record.ts`. See
[ADR 0006](0006-cigar-as-a-callback-walk.md) for why the array is built in the
consumer at all.
