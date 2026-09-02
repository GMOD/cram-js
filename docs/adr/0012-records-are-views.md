# 0012 — A record is a view onto its slice's columns

**Status:** accepted

## Context

By 13.4 nearly everything a decoded slice held was already columnar: read
features in a struct-of-arrays arena, quality scores in one array per slice,
tags in a column. The one thing still built per record was the record itself —
`decodeRecord` returned a 19-key literal, `new CramRecord(...)` copied it into a
27-field object, and a slice was a `CramRecord[]`.

That shape had two costs that the worker pool made visible.

- **The host rebuilt every record.** A slice could not cross `postMessage` as
  `CramRecord[]`, so `sliceTransfer.ts` packed the scalars into an `Int32Array`
  on the worker and the host unpacked them — one `new CramRecord` per record,
  serially, on the thread the pool exists to unburden. Measured at **0.52 µs a
  record**: 28 ms for SRR396637's 54,695 records against a 107 ms in-process
  decode of the same file. docs/workers.md records the consequence: the pool's
  speedup peaks at 2.7x around 100 kb and falls to 1.9x at 250 kb, because that
  serial share grows with the query.
- **The record object was most of what a short-read slice retained.** 27 fields
  at 8 bytes plus the header, on every record, next to ~100 bytes of quality
  scores and ~56 of name. SRR396637's 27.1 MB was 18.8 MB of JS heap.

A separate, smaller cost sat on the read path: a slice was three reads (a probe
of the header block's header, the header block, the data blocks) and a container
four, because `readBlock` reads a header then re-reads the block, and because
the slice header was parsed on the host before the data blocks were fetched.
TODO.md had carried it as "`readBlock` reads the same offset twice".

## Decision

**The decode writes columns and nothing else.** The per-record scalars go into
one `Int32Array` — eighteen slots a record — beside a presence byte and a
`Float64Array` of unique ids, and together with the arena, tag and quality
columns that is a `DecodedSlice`. It is the one representation: what
`decodeSliceFromBytes` produces for the worker and the in-process path alike,
what `featureCache` holds, and what a worker transfers. `serializeSlice` lists
its buffers; `deserializeSlice` reattaches two prototypes and does nothing per
record.

**A `CramRecord` is a view**: the slice and an index, with a getter per field
reading the column at that index. The fields mate association writes have
setters that write through. Views are handed out fresh by each query and are
meant to be short-lived; nothing on the path from the file to the cache
allocates one per record except mate association, whose views are discarded
before the slice is cached or sent. This is the shape bam-js adopted for the
same reasons ("a record is a view, and its fields decode on access").

**A slice is one read**, sized from the `.crai` or, without an index, from the
container's landmarks, and its header block is parsed out of that buffer. The
compression header block is likewise one read, since the first landmark is its
length. The in-process fallback that read blocks one at a time is gone, and so
is the "unknown slice size" case that kept a slice off the pool.

## Consequences

- The host does no per-record work on receiving a slice from a worker, which
  removes the serial term above. What is left of the host's share is the
  reference decoration and the filter.
- Retained heap on short reads drops by the record objects (numbers below). Long
  reads change little: 37 records were never the cost there.
- Records are per query. Two queries over one cached slice return views that are
  equal but not identical, and a write through one is visible to the other — the
  same as writing a cached record's field used to be, now stated.
- `CramRecord`'s public fields are getters. A consumer that assigned to a
  read-only one now throws in strict mode; a consumer that built records with
  `Object.create(CramRecord.prototype)` has to use the options constructor,
  which wraps the fields in a one-record slice. MIGRATION.md lists the rest.
- ADR 0007's rejection of a positional `CramRecord` constructor is superseded:
  there is no per-record constructor call on the decode path at all, which is
  what that item was measuring the cost of.
- `_refRegion` is per slice, keyed by sequence id, and the getter checks that
  the region covers the record. That was previously enforced at the moment of
  assignment and bypassed by tests that assigned the field directly; three of
  those fixtures described a region shorter than the record and were fixed.
- The `.crai` `sliceBytes` field is now load-bearing for the read, not only for
  the byte estimate; a wrong value fails the decode instead of costing an extra
  read.

## Evidence

Fresh process per tree, the baseline extracted with `git archive`, min of 7 cold
runs, whole-file queries. Retained heap is `heapUsed + arrayBuffers` after a
forced GC with the result held, and reproduces to ±0.2%; the wall-clock columns
are from an interleaved A/B on the same machine and carry the noise floor
TODO.md's method note describes.

Retained heap, from `pnpm docs:numbers` (its method; docs/memory.md carries the
full tables):

| fixture                 | records | before  | after   |          |
| ----------------------- | ------- | ------- | ------- | -------- |
| SRR396637 (short reads) | 54,695  | 27.1 MB | 22.6 MB | **−17%** |
| SRR396636 (short reads) | 23,051  | 12.1 MB | 10.2 MB | **−16%** |
| HG002 ONT (long reads)  | 37      | 6.8 MB  | 6.8 MB  | —        |

On SRR396637 the JS heap fell from 18.8 MB to 10.1 MB and the typed arrays rose
from 8.3 MB to 12.5 MB — the record objects became 81 bytes of columns each.

Wall-clock, from the least-loaded of three interleaved rounds on a machine whose
load average never went below 20 (other builds were running), so the ratios are
indicative and the absolute numbers are not:

| fixture   | cold decode, before → after | worker round trip, before → after |
| --------- | --------------------------- | --------------------------------- |
| SRR396637 | 190 ms → 157 ms             | 70 ms → 49 ms                     |
| SRR396636 | 58 ms → 60 ms               | 22 ms → 19 ms                     |
| ce#1000   | 71 ms → 68 ms               | 9 ms → 11 ms                      |

Every round put SRR396637's cold decode and round trip lower after than before;
the smaller files sat inside the noise. Re-measure on a quiet machine before
quoting a ratio.

The "transfer" column is `serializeSlice` + `structuredClone` +
`deserializeSlice` in one process — a structured clone rather than a transfer,
so it overstates the typed-array cost on both sides equally and is only
comparable across the two trees. What it shows is the per-record rebuild
disappearing on the short-read files; on ONT the clone of 3.5 MB of columns is
the whole of it either way.

Read counts on `ce#1000` (149 slices, ~30 containers, whole reference): 546
reads with a median under 80 bytes, to 231 — one per slice, three per container
— with the same 141,134-byte file read. `test/readAmplification.test.ts` pins
both numbers.
