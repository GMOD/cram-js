# TODO

Investigated, measured, not yet done. Numbers below were measured on this repo
at v8.7.0 — see the method note at the bottom before trusting or re-running them.

## Columnar (struct-of-arrays) read features

**Status:** prototyped and benchmarked, then discarded. Worth doing; needs a
coordinated change in jbrowse-components.

### Why

Read features are the dominant term in decoded-record memory on long-read data.
`decodeReadFeatures` allocates one `{code, pos, refPos, data}` object per
feature — 64 bytes each, 81 once `addReferenceSequence` adds `ref`/`sub` to the
X features. The ONT test fixture decodes 37 records into **213,602 feature
objects** (5,773 per read).

Measured retained heap, prototype vs current:

| workload | features/record | current | per-record SoA | **per-slice arena** |
| --- | --- | --- | --- | --- |
| `HG002_ONTrel2_16x_...` (ONT) | 5773 | 18.86 MB | 3.30 MB (−82%) | **3.64 MB (−81%)** |
| `SRR396636.sorted.clip` | 1.7 | 20.04 MB | 39.69 MB (**+98%**) | **16.55 MB (−18%)** |
| `SRR396637.sorted.clip` | 2.0 | 46.21 MB | 90.92 MB (**+97%**) | **36.40 MB (−21%)** |

### The trap — read this before starting

**Do not give each record its own set of typed arrays.** That is the obvious
columnar layout and it makes short-read files ~2x *worse*: each
`Uint8Array`/`Int32Array` carries ~100 bytes of fixed object overhead, so at
~2 features per record five per-record objects replace two 64-byte feature
objects. Short-read CRAM is the common case, so this would be a net regression
for most users.

Put the columns on the **slice** and give each record only a `(start, length)`
pair into them. Fixed overhead is then amortised across the whole slice and the
layout wins in both regimes — that is the "per-slice arena" column above.

### Shape that worked

`ReadFeatureArena`, one per slice, built in `_fetchRecords` and passed through
`SliceDecodeContext`:

- `codes: Uint8Array` — feature code as a char code
- `pos`, `refPos`, `num: Int32Array` — `num` holds the numeric payload for
  D/N/H/P/Q and the X substitution-matrix index
- `objs: (string | number[] | [string, number] | undefined)[] | undefined` —
  allocated lazily, only for the features that carry a string/array payload
  (I, S, b, i, q, B)
- `refCodes`, `subCodes: Uint8Array` — filled by `addReferenceSequence`, so the
  ~43%-of-features `ref`/`sub` strings disappear entirely
- geometric `reserve(n)` growth; total feature count is not known up front

`record.readFeatures` becomes a getter that materialises the old
array-of-structs view on demand, so unported consumers keep working. Measured
cost of that fallback: back to roughly baseline (18.81 / 20.44 / 46.73 MB) —
never worse than today, but it gives the win back, so jbrowse's two walks need
porting to keep it.

Consumers to port: `decodeReadSequence`, `getCigarString`,
`addReferenceSequence` (all in `src/cramFile/record.ts`), and in
jbrowse-components `plugins/alignments/src/CramAdapter/` —
`readFeaturesToMismatches.ts` and `readFeaturesToNumericCIGAR.ts`. Both are
already indexed `for` loops over `rf.code` string comparisons, so they become a
`switch` on a `Uint8Array` char code.

### Fold in while you are there

- **Preallocate `ref`/`sub` on X features.** Assigning a property the object was
  not constructed with makes V8 move its properties to an out-of-object backing
  store; constructing X with the slots present measures **−11.7% retained heap**
  on its own. Not landed separately because it makes the keys enumerable as
  `undefined` and churns all 103 snapshots — the arena pays that cost once. See
  the NOTE in `src/cramFile/slice/decodeRecord.ts`.
- **Coalesce consecutive single-base `i` insertions.** 34,387 of the ONT
  fixture's 213,602 features (16%) are single-base insertions that *both*
  jbrowse consumers immediately re-coalesce into runs. Coalescing at decode time
  drops 16% of feature slots and deletes the accumulate-and-flush logic from
  both walks. It changes the emitted feature list, so it belongs with the arena
  change rather than on its own.

## Cached slices redo their reference decoration on every query

`CramSlice.getRecords` serves records from `featureCache`, then unconditionally
re-runs the filter, recomputes the reference regions, **re-issues every
`fetchReferenceSequenceCallback` call**, and re-runs `addReferenceSequence` over
records that are already decorated. Five identical queries against a fully
cached file:

```
ONT       seqFetch calls per query: 1, 1, 1, 1, 1 | bases: 310089 ×5
Illumina  seqFetch calls per query: 3, 3, 3, 3, 3 | bases: 30280 ×5
```

`addReferenceSequence` is 9.0% of ONT decode self-time, and in jbrowse each of
those calls goes through `CramAdapter.seqFetch` to the sequence sub-adapter — so
every pan back over cached data re-reads reference sequence it already has. Fix
is to track the span the cached records are already decorated against and skip
when the new query is covered.

## `readBlock` reads the same offset twice

`readBlock` reads `cramBlockHeader.maxLength` at a position, then reads the full
block at the same position — the second read is a superset of the first. Per
cold decode: 2 of 8 filehandle reads on ONT, 6 of 22 on Illumina are redundant
(~25%), but only ~34–102 redundant *bytes*. Irrelevant locally; over HTTP it is
25% more range requests on the setup path. Measured at the CramFile→filehandle
boundary — check whether generic-filehandle2 already coalesces before changing.

## Simplifications (no perf angle)

- `CramSlice._fetchRecords` is ~390 lines doing six unrelated jobs: MD5 check,
  external-block int/byte classification, ITF8 pre-decoding, per-data-series
  decoder binding, per-tag decoder binding, and the record loop. Everything up
  to `tagDescriptorsByTL` is a pure function of (compression scheme, blocks,
  cursors) and could build the `SliceDecodeContext` in its own module.
- The `bind()` closures in that function are a fourth copy of the
  External/ByteArrayStop/ByteArrayLength decode logic, bounds checks included.
  A `CramCodec.bindDecoder(coreDataBlock, blocksByContentId, cursors)` returning
  a specialised closure (defaulting to `() => this.decode(...)`) would let each
  codec own its fast path and drop the `instanceof` chain.
- The self-clearing async memoize block is copy-pasted seven times across
  `file.ts`, `container/index.ts` and `slice/index.ts`.
- `sectionParsers.ts` has ~40 sites of
  `const [v, newOffsetN] = parseItf8(buffer, offset); offset += newOffsetN`,
  with `newOffset1..8` numbered inconsistently against the fields they belong
  to. A small reader over `(buffer, offset)` with `.itf8()`/`.ltf8()`/`.u8()`/
  `.u32()` would roughly halve the file.

## Measured and *not* worth doing

Recorded so they are not rediscovered:

- **`batchDecodeItf8` scratch sizing.** The `new Int32Array(buffer.length)`
  looks like a 4x over-allocation; measured utilisation is **97.5–100%** (ITF8
  values in these blocks are overwhelmingly single-byte) and the `.slice()` copy
  path fires on 0.15 MB of 14.70 MB.
- **A short-buffer fast path in `decodeUtf8`.** Node 24's `TextDecoder` matches
  or beats `String.fromCharCode.apply` at every length tested (73–114 ns/call vs
  62–147), and is 2x faster at length 12.
- **`CramRecord` hidden-class stability.** The conditional constructor
  assignments look like they would split the hidden class; measured **1 shape**
  across all records, because `target: es2022` implies
  `useDefineForClassFields`. Do not "fix" this, and note that lowering the
  compile target would silently undo it.
- **Read-feature polymorphism as a consumer cost.** Forcing true monomorphism
  made jbrowse's two walks no faster — noise in both directions. The `ref`/`sub`
  change above is worth doing for its *memory*, not for call-site shape.

## Method note

Retained-heap figures come from decoding into a held variable in a **fresh
process per variant**, with a forced GC either side and no warm-up decode (a
discarded `await` at module top level stays reachable and lands in the baseline,
which silently collapses the measured delta to ~0). Noise floor on a base-vs-base
control was ±0.2% for heap, ±1% for cold decode, ±8% for warm re-query.

**No wall-clock claim here is trustworthy** — the machine was loaded when these
were taken, and the timing noise floor is wider than most of the effects. In
particular it is *not* known whether the arena makes decoding faster as well as
smaller (it removes 213k allocations on ONT, so it probably does). Re-measure
timings on a quiet machine before quoting any.
