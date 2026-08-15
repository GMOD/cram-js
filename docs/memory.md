# Memory

A decoded CRAM slice is kept whole, in a cache, for as long as the file object
lives. What that costs depends almost entirely on read length, and the two ends
of that range fail in different ways — so this library plays the same trick
twice, on two different terms.

## Where the memory goes

Retained heap after decoding a whole file into a held variable, fresh process,
forced GC, `heapUsed + arrayBuffers`:

<!-- BEGIN GENERATED: retained-heap -->

Measured at **v13.3.0** — regenerate with `pnpm docs:numbers`.

| file                    | records | features | retained    | JS heap | typed arrays |
| ----------------------- | ------- | -------- | ----------- | ------- | ------------ |
| HG002 ONT (long reads)  | 37      | 213,602  | **6.8 MB**  | 1.0 MB  | 5.8 MB       |
| SRR396636 (short reads) | 23,051  | 40,212   | **12.1 MB** | 8.6 MB  | 3.5 MB       |
| SRR396637 (short reads) | 54,695  | 108,148  | **27.1 MB** | 18.8 MB | 8.3 MB       |

<!-- END GENERATED: retained-heap -->

**These are current figures, not historical ones**, and the difference matters
when reading the rest of this file. A number like the −12.8% below is what a
change was worth when it landed and stays true; a number like the retained total
above describes the code as it stands and goes stale the moment a record holds
something different. The generated blocks are the second kind —
`pnpm docs:numbers` recomputes them, and everything outside the markers is
written by hand. All of them had drifted by up to 12% before that script
existed.

Long reads put nearly everything in **read features** — that 37-record ONT slice
decodes 213,602 of them, ~95 KB of arena per record. Short reads have about two
features each and put nearly everything in **per-record objects** instead: the
record, its quality scores, its name. Two things used to be on that list and are
now columns — see [the migration note](../MIGRATION.md) for both:

- its **mate**, a `MateRecord` per paired record, now two numbers on the record.
- its **tags**, a `Record` per record, now
  [`TagColumn`](../src/cramFile/tagColumn.ts). Unlike everything else here, this
  one is **not** a memory technique: it came out break-even (−0.06 MB on
  SRR396637, +0.20 MB on SRR396636). It was taken so that tags can cross a
  worker boundary by transfer (243 ms of structured clone → 11 ms), and so that
  `getTag(name)` can answer for one tag without building the object. Its header
  comment has the full numbers.

## The costs that drive the design

Measured on this V8 (Node 24), 200,000 instances each, so they are worth knowing
before optimizing anything here:

|                            |                                  |
| -------------------------- | -------------------------------- |
| retained `Uint8Array` view | **104 B**, whatever it points at |
| declared class field       | **8 B**                          |
| empty `{}`                 | 56 B                             |
| 25-character string        | 56 B                             |
| 3-property object          | 48 B                             |

The first line is the important one. A `Uint8Array` is an object with a backing
store, a byte offset and a length, and none of that gets cheaper because the
view is small. **A per-record view over ~100 bytes costs more than the bytes.**
The second line means a field added to `CramRecord` is 437 KB across a
54,000-record view.

## Columns, not objects

Both techniques below are the same move: take a thing there is one of per record
(or per read feature), and store it as one shared typed array per slice plus an
offset, so the fixed per-object overhead is paid once for the slice instead of
once per record.

### Read features — `readFeatureArena`

An `{code, pos, refPos, data}` object costs 64 bytes, and 81 once
`addReferenceSequence` adds `ref`/`sub` to a substitution — and adding a
property the object was not constructed with moves V8's properties
out-of-object, which is 11.7% of retained heap on its own. As columns it is 15
bytes per feature.

The columns are deliberately **per slice, not per record**. Giving each record
its own typed arrays makes short-read files about twice as expensive as plain
objects, because ~100 bytes of fixed overhead lands on the ~2 features a short
read carries. See [read-features.md](read-features.md) for how to read them.

Not every column is stored per feature. A feature's payload offset used to be,
at 4 bytes each, and was pure redundancy — payloads are appended in slot order
and a slot's length is already known from its code and `num`, so the offsets
were a running prefix sum, and three quarters of them indexed a feature carrying
no bytes at all. `payloadChunks` keeps one every eighth slot and derives the
rest, which is the 4 bytes that took a feature from 19 to 15:
[ADR 0010](adr/0010-checkpoint-the-payload-offsets.md).

What the columns cost today, which is the table to look at before proposing to
shrink one — `scripts/arena-columns.ts` prints it per fixture, with the feature
histogram the percentages come from:

<!-- BEGIN GENERATED: arena-columns -->

Measured at **v13.3.0** — regenerate with `pnpm docs:numbers`.

| column          | ONT              | SRR396636        | SRR396637        |
| --------------- | ---------------- | ---------------- | ---------------- |
| `codes`         | 208.6 KB (5.9%)  | 39.3 KB (4.8%)   | 105.6 KB (5.5%)  |
| `pos`           | 834.4 KB (23.7%) | 157.1 KB (19.2%) | 422.5 KB (22.0%) |
| `refPos`        | 834.4 KB (23.7%) | 157.1 KB (19.2%) | 422.5 KB (22.0%) |
| `num`           | 834.4 KB (23.7%) | 157.1 KB (19.2%) | 422.5 KB (22.0%) |
| `payloadChunks` | 104.3 KB (3.0%)  | 19.6 KB (2.4%)   | 52.8 KB (2.7%)   |
| `refCodes`      | 208.6 KB (5.9%)  | 39.3 KB (4.8%)   | 105.6 KB (5.5%)  |
| `subCodes`      | 208.6 KB (5.9%)  | 39.3 KB (4.8%)   | 105.6 KB (5.5%)  |
| `payloadBytes`  | 290.9 KB (8.3%)  | 208.8 KB (25.5%) | 286.0 KB (14.9%) |
| **total**       | **3524.2 KB**    | **817.4 KB**     | **1923.0 KB**    |

|                 | ONT            | SRR396636     | SRR396637      |
| --------------- | -------------- | ------------- | -------------- |
| features        | 213,602        | 40,212        | 108,148        |
| carrying bytes  | 53,292 (24.9%) | 8,744 (21.7%) | 15,020 (13.9%) |
| payload indexed | 290.9 KB       | 208.8 KB      | 286.0 KB       |

<!-- END GENERATED: arena-columns -->

### Quality scores — `qualityColumn`

Same trade, aimed at the other end. Every score in a slice lies end to end in
one array and a record keeps a `qualityStart` offset into it, which removes 104
bytes per record: measured when it landed, SRR396637 went from 37.4 MB retained
to 32.6 (−12.8%) and SRR396636 from 16.9 to 14.9 (−11.9%). ONT did not move at
all — 37 records is 37 views, and there was nothing there to save. (Those totals
are lower now, for reasons further down this file; the deltas are what the
change was worth.)

When QS is a plain external block, that column **is** the block: the scores are
already laid out end to end in record order, so nothing is copied and reading a
record's scores is cursor arithmetic. Other QS encodings decode into a growable
column that is trimmed when the slice finishes.

`record.qualityScores` still hands back a `Uint8Array` — it builds the view on
demand, so nothing retains one. If you are reading scores per base, hoist the
column instead:

```js
// allocates one view per call
const q = record.qualityScores?.[i]

// allocates nothing
const q = record.qualityScoreAt(i)

// allocates nothing, for a loop over every base
const { qualityColumn, qualityStart } = record
for (let i = 0; i < record.readLength; i++) {
  const q = qualityColumn[qualityStart + i]
}
```

## Laziness that holds a view is a pessimization

Read names used to be deferred: the record kept the raw `Uint8Array` off the RN
block and decoded on first access. Patching the getter never to materialize, so
that every record kept its view, took SRR396637 from 37.7 MB to **40.9** — the
104-byte view is nearly twice the ~56 bytes of the name it was avoiding
decoding. Deferring only pays if you hold something _smaller_ than the result,
and a typed-array view over a short run of bytes is not that.

So names are decoded during the slice decode. That also collapsed
`_readName`/`_readNameRaw`/`_syntheticReadName` into one field and removed a
duplicate string per detached record, since the mate's name was decoded eagerly
and then the record's own name decoded the same bytes again later. Worth ~2 MB
on both short-read fixtures. The general form of the same lesson:

- **Defer a computation, not a view.** A lazily-decoded `record.qualityScores`
  is fine because the offsets it defers behind are two numbers on an object that
  already exists; a lazily-decoded read name was not, because the thing it
  deferred behind was a whole object.
- **Check who forces it anyway.** Mate association already read `readName` for
  53,472 of SRR396637's 54,695 records, so the deferral was mostly notional
  before it was removed.

## The slice cache

`cacheSize` (default 1,000,000) bounds the decoded-slice cache by **record
count**, not by slices: one slice holds anywhere from a handful of records to
tens of thousands, so a slice-counting bound is meaningless — 20,000 slices of
long reads is hundreds of gigabytes.

The number has to sit **above one query's working set**, which is why the
default is what it is. `getRecordsForRange` starts every slice of a range at
once and holds all of their records until it returns, so a budget below that
does not cache less — it caches _nothing_, evicting each slice before the next
pan can reuse it while retaining the memory anyway. A 50kb window on 200x
short-read data is 90,000 records; the old 20,000 default was 4.5x below it.
[ADR 0004](adr/0004-size-the-slice-cache-above-one-query.md) has the working
sets.

Eviction is plain LRU, so `cacheSize` is a bound that is honored. It used to be
a `'batch'` policy that spared everything an in-flight query touched, which
rescued a too-small budget by exceeding it — 420,000 records held against a
stated 20,000. At a budget above the working set the two measure identically, so
the policy was dropped rather than kept for the case where it lies about the
limit: [ADR 0005](adr/0005-drop-the-batch-eviction-policy.md).

Two other knobs: `cacheIdleTimeoutMs` (default 3 minutes) drops slices nothing
has read for that long, and is the only thing that lowers the cache while
nothing is happening; `cacheBudget` lets several `CramFile`s share one ceiling.

## What the worker pool adds

Everything above is the JS heap, and it is where a query's memory goes. The pool
adds two things that sit outside it, both per worker rather than per file, and
neither scaling with the query:

- **A wasm heap per JS context.** The htscodecs module has a 16 MB floor (see
  [wasm.md](wasm.md#memory)), and every context that decodes gets its own
  instance. With the default `min(hardwareConcurrency, 4)` workers that is up to
  **80 MB before a record is decoded** — four workers plus the main thread,
  which needs an instance of its own whatever the pool does, because gunzipping
  the `.crai` is itself a wasm call. `numSliceWorkers` is the knob; a host that
  runs several worker contexts multiplies this again, as it does the pool
  itself.
- **Up to 16 parsed compression schemes per worker**, each holding a codec per
  data series and per tag it has seen, plus the header bytes it was parsed from
  (294 B–11.7 KB across the fixtures here). Bounded, and small next to one
  decoded slice, but retained between queries rather than with them.

Both are floors, not per-query costs: paid once per worker, and they do not grow
with the region.

## Measuring it

`scripts/measure-heap.ts` reports retained heap for one of the fixtures in a
fresh process, with `--walk` to include a jbrowse-style consumer walk:

```bash
node --expose-gc --experimental-strip-types scripts/measure-heap.ts ONT
```

`scripts/arena-columns.ts` is the companion that takes the arena apart — bytes
per column, the feature histogram, and how much of each column is doing
anything. Reach for it when the question is _which_ column to attack rather than
how much a slice weighs.

`pnpm docs:numbers` runs both over every fixture and writes the two tables above
back into this file. Run it after anything that changes what a decoded record
holds, and commit the result with the change — the tables are the denominators
the ADRs quote percentages against, so a stale one quietly makes every one of
those percentages wrong.

It is deliberately **not** a CI check. Retained heap reproduces to ±0.2% on one
machine but not across V8 versions or machines, so a `--check` gate would fail
for reasons that say nothing about the commit under test. The version stamp in
each table is what tells a reader how far back the numbers are from instead.

Two traps, both found the hard way:

- **`heapUsed` does not see typed arrays.** V8 allocates ArrayBuffer backing
  stores outside the JS heap, so a struct-of-arrays layout looks nearly free if
  that is all you read — the first columnar measurement came out at 0.93 MB
  against an 18.07 MB baseline. Add `arrayBuffers`.
- **Do not A/B two source trees in one process.** Importing a baseline and a
  candidate side by side made the columnar decode look 7–11% _slower_,
  consistently enough to look real. It was the two variants sharing a heap and a
  GC history. Alternate processes, not imports — and use a fresh process with no
  warm-up decode, since a discarded top-level `await` stays reachable and lands
  in the baseline, collapsing the measured delta to ~0.

Retained-heap numbers reproduce to within ±0.2%. Wall-clock on this repo does
not: the noise floor is several percent even on an idle machine and far wider on
a loaded one, so re-measure before quoting any timing here.

## What is deliberately not done

[ADR 0007](adr/0007-optimizations-measured-and-rejected.md) records the
measured-and-rejected ones with their numbers — interning the decoded strings,
per-record typed arrays, coalescing single-base insertions, a positional
`CramRecord` constructor. [TODO.md](../TODO.md) has the remaining wins that have
been measured but not yet taken.
