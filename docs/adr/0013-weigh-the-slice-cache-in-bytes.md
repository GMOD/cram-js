# 0013 — Weigh the slice cache in bytes

**Status:** accepted — `cacheSize` (records, default 1,000,000) becomes
`maxCacheBytes` (bytes, default 1 GB), weighed by `DecodedSlice.byteLength`.
Supersedes the unit half of
[ADR 0004](0004-size-the-slice-cache-above-one-query.md); its working sets and
idle timeout stand.

## Context

`featureCache` bounded itself by record count because a `CramRecord` was an
object with no cheap size — 27 fields, a mate object, a tags `Record`, read
features as objects — and counting records was the only unit the cache could
afford to compute. ADR 0004 said so, and said the consequence out loud: a record
count cannot bound memory, and the budget only ever binds on short-read data,
since long-read slices are few and huge.

It also made `cacheBudget` less useful than it looks. `@gmod/shared-read-cache`
requires every member of a budget to weigh in one unit, and `@gmod/bam` weighs
in decompressed bytes, so a consumer with BAM and CRAM tracks side by side had
to keep two budgets that could not see each other.

Since [ADR 0012](0012-records-are-views.md) a decoded slice is columns — typed
arrays, plus three string arrays — and a typed array knows its `byteLength`.

## Decision

`DecodedSlice.byteLength` sums every typed-array column (the scalars, presence
and unique ids; the arena's eight columns; the quality bytes; the tag column's
three) and estimates the rest: each string at its length plus 32 B, from the 56
B a 25-character string measures on this V8, each array slot at 8 B, and each
reference region the same way. `ReadFeatureArena` and `TagColumn` each report
their own.

The cache's `sizeOf` is that getter. The option is `maxCacheBytes` and the
default `DEFAULT_MAX_CACHE_BYTES = 1 GB`, the same name and number as
`@gmod/bam`'s, so that one `SharedBudget` can hold both libraries' files.
`cacheBudget` and `cacheIdleTimeoutMs` are unchanged.

## Consequences

- **The budget is a bound on retained slice memory, to within a few percent.**
  It is still not a bound on peak memory: reads in flight, the last settled
  entry, and everything a query holds until it returns sit outside it, as they
  did.
- **Long-read data is now inside the bound.** One ONT slice weighs 6 MB and
  counted as 37 records before; 200 such slices reach the default, where 200 ×
  37 records never came near 1,000,000.
- **A byte budget can be shared with `@gmod/bam`.** A jbrowse worker can hand
  one `SharedBudget` to every alignments track, whichever format it reads.
- The weight is taken when the decode settles and does not grow after: a slice
  memoizes nothing onto itself later except reconstructed read bases
  (`getReadBases` on a record decoded without a reference), which are strings in
  the estimated part.
- `scripts/measure-heap.ts` reports the weight beside the measured heap, and
  `pnpm docs:numbers` writes both into memory.md, so the two stay comparable as
  the columns change.

## Evidence

Fresh process per fixture, whole-file query, `heapUsed + arrayBuffers` after a
forced GC (the method in docs/memory.md), reproducible to ±0.2%. "Retained" is
what `pnpm docs:numbers` reports: the slices plus the `CramRecord` views the
query handed back, held together. "Views" is what releasing the record array and
keeping the slices gave back; "floor" is the same setup after a query that
touched no slice (the index, SAM header, module glue), 0.33–0.39 MB. "Slices" is
retained less both.

| fixture                 | records | retained | views  | slices  | weighed  | weighed / slices |
| ----------------------- | ------- | -------- | ------ | ------- | -------- | ---------------- |
| HG002 ONT (long reads)  | 37      | 6.82 MB  | 0.0 MB | 6.4 MB  | 5.97 MB  | **0.93**         |
| SRR396636 (short reads) | 23,051  | 10.27 MB | 1.6 MB | 8.4 MB  | 7.94 MB  | **0.95**         |
| SRR396637 (short reads) | 54,695  | 22.57 MB | 3.6 MB | 18.6 MB | 18.46 MB | **0.99**         |

The estimate was checked term by term by releasing one column at a time and
measuring what came back:

| term                     | measured         | estimated |
| ------------------------ | ---------------- | --------- |
| read name, ~20 chars     | 63–64 B a string | 60 B      |
| tag string, ~5 chars     | 42–43 B a string | 45 B      |
| arena, SRR396637         | 2.15 MB          | 1.97 MB   |
| quality bytes, SRR396637 | 4.80 MB          | 5.47 MB   |

The typed columns are exact by construction; the two arena/quality lines differ
from their `byteLength` because the quality column can be a view into the same
external block the arena's payload bytes point into, so releasing one does not
free what the other still holds. Summed they agree.

The views are worth knowing about even though they are not the cache's: a
`CramRecord` is a `slice`, an `index`, a precomputed offset and a tags memo, and
at 69 B each a query over 54,695 records holds 3.6 MB of them until the consumer
lets the array go. That is the per-query cost ADR 0012 traded the per-record
object for, and it is not retained by anything once the query returns.
