# 0004 — Size the slice cache above one query, and reclaim it when idle

**Status:** accepted — `cacheSize` 20,000 → 1,000,000 records, plus
`cacheIdleTimeoutMs` (default 3 minutes) and `clearFeatureCache`. The eviction
policy this assumed was later dropped by
[ADR 0005](0005-drop-the-batch-eviction-policy.md).

## Context

`featureCache` is bounded by decoded **record count**, and defaulted to 20,000.
The number predated any measurement of what one query needs.

A budget below one query's working set does not cache less — it caches
_nothing_. Each slice is evicted before the next pan can reuse it, so the hit
rate is zero, the decode is paid again every time, and the memory is retained
anyway. Every short-read width measured was over that line, one of them by 21x.

The old default also did not bound what it claimed to. The cache shipped with an
`evictionPolicy: 'batch'`, which spares everything the batch touched, so a
20,000-record budget was measured **holding 420,000**. Raising the number makes
it honest as well as useful.

## Decision

- `DEFAULT_CACHE_SIZE = 1_000_000`.
- `cacheIdleTimeoutMs`, default 3 minutes, `0` opts out.
- `clearFeatureCache()`, on both `CramFile` and `IndexedCramFile`.

Both options are threaded through `IndexedCramFile`, which is what a consumer
actually constructs — an option that stopped at `CramFile` would be unreachable.

## Consequences

- **A record count cannot bound memory, and this does not pretend to.** There is
  no cheap way to size a decoded record, which is why the unit is what it is
  (see [MEMORY.md](../MEMORY.md#the-slice-cache)). One useful consequence: the
  budget only ever binds on short-read data, where records are small and
  numerous. Long-read slices are few and huge — 2,991 records for a 50kb window
  at 1000x — so they never approach it.

- **The idle timeout is what makes the number affordable.** `cacheSize` is
  applied when a decode settles, so it does nothing for a consumer sitting
  still, and jbrowse's `CramAdapter` memoizes one `IndexedCramFile` for the life
  of the track. Without the timeout, a parked tab holds its whole last view
  until the track closes, times every open track. It is timed from the last
  _read_ of a slice, not the decode, so panning back and forth over one region
  never expires it.

- **`'batch'` still stands, but for its own reason and not as a substitute for a
  big enough budget.** @gmod/bam measured it failing to rescue an undersized
  budget — identical refill count to `'lru'`, and 1.7x worse on memory
  (@gmod/bam ADR 0013). It wins on a _repeated identical_ query; it does not
  make a too-small budget work. (Superseded:
  [ADR 0005](0005-drop-the-batch-eviction-policy.md) dropped the policy
  outright.)

- **Matches @gmod/bam and @gmod/tabix**, which took the same shape at the same
  time for the same reason: @gmod/bam 100MB → 1GB (its ADR 0014/0015),
  @gmod/tabix 100MB → 1GB.

## Evidence

Working set for a single query, measured with an unbounded cache on the jb2bench
CRAMs:

| corpus            | window | slices |     working set | of the 20k default |
| ----------------- | -----: | -----: | --------------: | -----------------: |
| `200x.shortread`  |   20kb |      4 |  40,000 records |               200% |
| `200x.shortread`  |   50kb |      9 |  90,000 records |               450% |
| `1000x.shortread` |   20kb |     18 | 180,000 records |               900% |
| `1000x.shortread` |   50kb |     42 | 420,000 records |              2100% |
| `1000x.longread`  |   50kb |     30 |   2,991 records |                15% |

Six-window 50kb pan, second pass:

| `cacheSize` | `200x.shortread` | `1000x.shortread` |
| ----------- | ---------------: | ----------------: |
| 20,000      |           1231ms |            3167ms |
| 100,000     |            834ms |            3207ms |
| 500,000     |         **36ms** |            3059ms |
| 1,000,000   |             32ms |         **279ms** |

Working sets were measured with `cacheSize: Infinity`. With a budget applied,
`totalSize` reports what survived eviction rather than what the query needed,
which is a mistake worth avoiding deliberately (@gmod/bam ADR 0013's correction
note). The pan is six 50kb windows stepping 25kb and doubling back, timed on the
second pass. `LocalFile`, so a refill costs decode only; over HTTP it also costs
a round trip, widening every gap above.
