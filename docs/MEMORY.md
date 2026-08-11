# Memory

A decoded CRAM slice is kept whole, in a cache, for as long as the file object
lives. What that costs depends almost entirely on read length, and the two ends
of that range fail in completely different ways — so this library uses the same
trick twice, on two different terms.

## Where the memory goes

Retained heap after decoding a whole file into a held variable, fresh process,
forced GC, `heapUsed + arrayBuffers`:

| file                    | records | retained | JS heap | typed arrays |
| ----------------------- | ------- | -------- | ------- | ------------ |
| HG002 ONT (long reads)  | 37      | 7.10 MB  | 0.62    | 6.49         |
| SRR396637 (short reads) | 54,695  | 30.7 MB  | 22.0    | 8.7          |

Long reads put nearly everything in **read features** — that 37-record ONT slice
decodes 213,602 of them, 118 KB of features per record. Short reads have about
two features each and put nearly everything in **per-record objects** instead:
the record, its quality scores, its tags, its name. (Its mate used to be on that
list — a `MateRecord` per paired record, so one per record on a paired
short-read file. It is now two numbers on the record itself; see
[the migration note](../MIGRATION.md).)

## The costs that drive the design

Measured on this V8 (Node 24), 200,000 instances each, so they are worth knowing
before optimising anything here:

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
The second line means a field you add to `CramRecord` is 437 KB across a
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
out-of-object, which is 11.7% of retained heap on its own. As columns it is 19
bytes per feature.

The columns are deliberately **per slice, not per record**. Giving each record
its own typed arrays makes short-read files about twice as expensive as plain
objects, because ~100 bytes of fixed overhead lands on the ~2 features a short
read carries. See [READ_FEATURES.md](READ_FEATURES.md) for how to read them.

### Quality scores — `qualityColumn`

Same trade, aimed at the other end. Every score in a slice lies end to end in
one array and a record keeps a `qualityStart` offset into it, which removes 104
bytes per record: SRR396637 went from 37.4 MB retained to 32.6 (−12.8%) and
SRR396636 from 16.9 to 14.9 (−11.9%), while ONT did not move at all — 37 records
is 37 views, and there was nothing there to save.

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

## Laziness that holds a view is a pessimisation

Read names used to be deferred: the record kept the raw `Uint8Array` off the RN
block and decoded on first access. Patching the getter never to materialise, so
that every record kept its view, took SRR396637 from 37.7 MB to **40.9** — the
104-byte view is nearly twice the ~56 bytes of the name it was avoiding
decoding. Deferring only pays if you hold something _smaller_ than the result,
and a typed-array view over a short run of bytes is not that.

So names are decoded during the slice decode, which also collapsed
`_readName`/`_readNameRaw`/`_syntheticReadName` into one field and removed a
duplicate string per detached record (the mate's name was decoded eagerly, then
the record's own name decoded the same bytes again later). Worth ~2 MB on both
short-read fixtures. The general form of the same lesson:

- **Defer a computation, not a view.** A lazily-decoded `record.qualityScores`
  is fine because the offsets it defers behind are two numbers on an object that
  already exists; a lazily-decoded read name was not, because the thing it
  deferred behind was a whole object.
- **Check who forces it anyway.** Mate association already read `readName` for
  53,472 of SRR396637's 54,695 records, so the deferral was mostly notional
  before it was removed.

## The slice cache

`cacheSize` (default 20,000) bounds the decoded-slice cache by **record count**,
not by slices: one slice holds anywhere from a handful of records to tens of
thousands, so a slice-counting bound is meaningless — 20,000 slices of long
reads is hundreds of gigabytes.

Eviction waits until nothing is decoding, and spares every slice the batch that
just finished touched. This matters more than it sounds. `getRecordsForRange`
starts every slice of a range at once and holds all of their records until it
returns, so evicting one mid-query frees nothing — it only guarantees the next
identical query re-decodes it. A range holding more records than the whole
budget would otherwise evict its own earlier slices as its later ones landed,
which is the worst case for a plain LRU: repeating one 54,695-record query
against the default budget re-read 1.9 MB and re-inflated 6.0 MB every time, 117
ms against the 13 ms it takes when the slices survive.

So the cache can exceed `cacheSize` while a query is in flight, by that query's
own records — which the caller is holding anyway — and settles back to the bound
once it finishes.

## Measuring it

`scripts/measure-heap.ts` reports retained heap for one of the fixtures in a
fresh process, with `--walk` to include a jbrowse-style consumer walk:

```bash
node --expose-gc --experimental-strip-types scripts/measure-heap.ts ONT
```

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

[TODO.md](../TODO.md) records the measured-and-rejected ones with their numbers
— per-record typed arrays, coalescing single-base insertions, a positional
`CramRecord` constructor — along with the remaining wins that have been measured
but not taken.
