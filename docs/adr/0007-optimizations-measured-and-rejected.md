# 0007 — Optimizations measured and rejected

**Status:** accepted

## Context

This ADR records a family of decisions in one place rather than one each,
because we settled them all the same way. Someone looked at the decode, saw an
obvious waste, measured it, and found the waste was not where it looked. The
shared pattern is worth reading, and each decision on its own is only a
paragraph.

Two lessons recur, and they are why we record these decisions instead of
dropping them without a note:

- **A fixed per-record cost is not free just because it is small.** Typed
  arrays, `TextDecoder` calls and object allocations all have a fixed overhead
  that a 100 bp short read cannot amortize and a 49 kb long read never notices.
  Every item below that failed, failed on short reads.
- **Deduplication that has to look at the bytes cannot be cheaper than producing
  the bytes.** That lesson is the whole of the interning result.

## Decision

We did none of the following, and none should be reopened without evidence that
contradicts the numbers under **Evidence**:

- Interning the decoded strings.
- A positional `CramRecord` constructor.
- Coalescing consecutive single-base `i` insertions at decode time.
- Shrinking `batchDecodeItf8`'s scratch buffer.
- A short-buffer fast path in `decodeUtf8`.
- "Fixing" `CramRecord`'s conditional constructor assignments for hidden-class
  stability. The assignments need no fix, and the fix would be a pessimization
  to guard against.
- Reshaping read features to make consumer call sites monomorphic.
- Building a `Uint32Array` CIGAR for every read regardless of length.

Deferring the read name behind a getter was rejected too, for the same reason:
after batching had already taken names from ~10.4 ms to ~1.5 ms, only ~1.4% of
the decode was left to defer. See
[ADR 0002](0002-batch-decoding-over-lazy-fields.md) for the detail.

## Consequences

The decode still pays the costs these would have removed. We list two of them
here so that nobody mistakes them for oversights:

- **A slice's whole decoded name block stays alive as long as any record from it
  lives.** Interning would recover that; see ADR 0002's consequences for the
  trade as it stands.
- **Consumers coalesce runs of single-base insertions themselves**, in their own
  walks, as htslib does.

## Evidence

Every measurement below ran one source tree per process, alternating, and
compared fastest runs rather than medians, with an A-vs-A control to establish
the noise floor. [docs/memory.md](../memory.md#measuring-it) describes the
measurement errors that make this necessary.

### Interning the decoded strings

We tried interning, measured it and reverted it. **The duplication is real and
large**: SRR396637 has 164,526 tag values with only **1,084 distinct** ones
(`MC` is a CIGAR string repeated across nearly every record), and 27,462
distinct read names for 54,695 records, because the two mates of a pair share
one. A per-slice `Map<string, string>` in `bindStringReader` saves exactly the
memory we expected:

| dataset   | retained, sharing | retained, interned   |
| --------- | ----------------- | -------------------- |
| SRR396637 | 31.55 MB          | **29.49 MB** (-6.5%) |
| SRR396636 | 13.27 MB          | **12.48 MB** (-6.0%) |
| ONT       | 7.47 MB           | 7.47 MB (37 records) |

The interned figure is 1.19 MB _below_ the retained heap before any of the
batching work, and below the un-interned reader too.

**It costs 10-20% of the decode**, far more than the memory is worth on a decode
path built for speed. We ran 12 paired rounds against 7023d88 with an A-vs-A
control: SRR396637 -15.5% mean, faster in **0/12** (control -2.9%, 5/12);
jb2bench 200x -10.9%, 2/12 (control +2.1%); jb2bench 1000x -20.6%, 1/12 (control
-4.6%). ONT measures +15.8%, but its control measures +13.3%, so that is drift,
not an effect.

Interning is slow because a `Map` keyed by string has to **hash the string**,
which means reading every character of it. The decode does that ~220,000 times
on SRR396637, for values that batching had just made very cheap to produce.

An earlier note claimed two more benefits for interning, and interning has
_neither_. It does not let the GC collect the decoded block, because interning
keeps one reference per distinct value, and one reference pins the block just as
well as fifty thousand. And it does not remove the temporary string, which the
reader allocates in order to hash it, whether or not the map keeps it.

### A positional `CramRecord` constructor

`decodeRecord` builds a 19-key object literal that `new CramRecord(...)`
immediately destructures and drops, one per record. The short-read path is bound
by per-record work and GC, so removing that object looks like an easy speedup.
Having `decodeRecord` return the `CramRecord` directly, through a 19-argument
positional constructor, does remove the allocation, and the output is
byte-identical (sha256 over `toJSON()` + `getCigarString()` +
`getPairOrientation()` for all 92,582 records in `test/data`).

Five alternating processes per tree, median-of-medians, put the positional
constructor at 129.6 → 128.5 ms on SRR396637 and 56.2 → 56.0 ms on SRR396636,
both inside the ±1% cold-decode noise floor. GC time does drop consistently (107
→ 94 ms on SRR396637, ~12%), which confirms the allocation is gone, but GC is
only ~8% of that decode, so the saving never reaches 1% end to end.

Against that saving, the constructor would take nineteen unlabelled positional
parameters, sixteen of them `number` or `number | undefined`, where any
transposition still typechecks. It would also be a breaking change to a public
constructor. The constructor does have a type problem worth fixing on its own
terms, which is a different change and is in `TODO.md`.

### Coalescing consecutive single-base `i` insertions

The claim was that 34,387 of the ONT fixture's 213,602 features (16%) are
single-base insertions "that both jbrowse consumers immediately re-coalesce into
runs". They are single-base insertions, but they are _isolated_: counting
adjacent `(i, i)` slot pairs — exactly the pair a consumer merges, since two
adjacent `i` features share a reference position if and only if their read
positions are adjacent — gives **0 runs on ONT, 0 on SRR396636, 0 on
SRR396637**.

Coalescing at decode time therefore gave nothing on all three, in exchange for a
per-feature branch in the decode loop and a change to a public output shape (it
altered exactly one of the 189 snapshots, the grc37-1 Illumina one). htslib does
not merge the features either — its `case 'i'` accumulates into the _CIGAR_ via
`cig_len++` while keeping one decode step per feature (`cram/cram_decode.c`).

### `batchDecodeItf8` scratch sizing

The `new Int32Array(buffer.length)` looks like a 4x over-allocation. Measured
utilization is **97.5–100%**, because ITF8 values in these blocks are
overwhelmingly single-byte, and the `.slice()` copy path fires on 0.15 MB of
14.70 MB.

### A short-buffer fast path in `decodeUtf8`

Node 24's `TextDecoder` matches or beats `String.fromCharCode.apply` at every
length tested (73–114 ns/call against 62–147), and is 2x faster at length 12.

### `CramRecord` hidden-class stability

The conditional constructor assignments look like they would split the hidden
class. We measured **1 shape** across all records, because `target: es2022`
implies `useDefineForClassFields`. Lowering the compile target would undo this,
and no test would catch it.

### Read-feature polymorphism as a consumer cost

Forcing true monomorphism made jbrowse's two walks no faster — noise in both
directions. Moving `ref`/`sub` into the arena's byte columns was worth doing for
its _memory_, not for call-site shape.

### A `Uint32Array` CIGAR for every read

In jbrowse's `readFeaturesToNumericCIGAR` the typed array is 8.7% faster and
half the retained bytes on ONT (median 4391 ops/read), but **147% slower and
2.4x the memory** on short reads (median 1 op/read), where a one-element payload
pays ~96 bytes of fixed typed-array overhead. The per-record arena failed the
same way. That walk switches per read at 64 ops, matching the ~50–100 crossover
bam-js measured in its own `src/record.ts`. See
[ADR 0006](0006-cigar-as-a-callback-walk.md) for why the array is built in the
consumer at all.

### `HEAPU8.slice` in `copyFromWasm`

`copyFromWasm` allocates a zero-filled `Uint8Array` and `set`s the wasm heap
into it; `module.HEAPU8.slice(ptr, ptr + size)` is one allocation-and-copy, and
the function showed at 2.4–3.7% of a cold-decode CPU profile. Measured in
isolation, min of 25 rounds per size, the two are the same from 64 KB up
(slice/set 0.94–1.01) and slice is 0.1 µs faster at 1 KB — a few microseconds a
slice. End to end, four interleaved rounds of the per-codec timing script on
SRR396637 and the ONT fixture put block decompression at 34.4 ms → 35.0 ms and
13.6 ms → 14.8 ms (minimums, set → slice) against a within-variant spread of
34–88 ms, so neither direction rose above the noise floor, and we did not take
the change.
