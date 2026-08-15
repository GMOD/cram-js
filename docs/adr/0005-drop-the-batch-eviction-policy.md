# 0005 — Drop the `'batch'` eviction policy

**Status:** accepted — supersedes the policy choice
[ADR 0004](0004-size-the-slice-cache-above-one-query.md) inherited and left
standing.

## Context

The slice cache shipped with `evictionPolicy: 'batch'`, adopted on a measurement
of 117ms against 12ms on a repeated 55,000-record range. That measurement was
taken with `cacheSize` at **20,000** — a budget 2.75x below the query's working
set.

ADR 0004 raised `cacheSize` to 1,000,000, above the working set of every query
measured. That removes the premise `'batch'` was adopted under, so the policy
was re-measured rather than assumed to still be earning its keep.

What `'batch'` does is defer eviction until no reads are in flight and then
**spare everything the batch touched**. When a batch touches more than the whole
budget, the cache is left over the budget — that is the documented trade, and it
is how `'batch'` rescues a too-small budget: by not honoring it.

## Decision

Use `'lru'`, the package default. `cacheSize` becomes a bound that is actually
honored.

## Consequences

- **Nothing changes for real consumers.** jbrowse's `CramAdapter` never passes
  `cacheSize`, so it takes the default, where the two are measurably the same.
  The only code affected is a consumer that explicitly sets a small budget.

- **And for that consumer, this is the fix rather than the regression.** Setting
  `cacheSize: 20000` is a request to constrain memory. Under `'batch'` that
  request was answered with 420,000 records held. Being slower than you asked
  for is a worse-but-honest outcome than being given 21x the memory you asked
  for — particularly in a browser, where the second one is a dead tab.

- **What is given up, explicitly**: when a single query's working set exceeds
  the budget, `'lru'` evicts within the query and the repeat re-decodes. That is
  the pathology `'batch'` was adopted against, and it is now reachable only
  above 1,000,000 records. The fix there is a bigger `cacheSize`, not a policy
  that ignores it — @gmod/bam reached the same conclusion from the other
  direction, measuring `'batch'` failing to rescue an undersized budget at all
  on a pan workload (identical refills, 1.7x worse on memory: @gmod/bam ADR
  0013).

- **`test/sliceRecordCache.test.ts` flipped an assertion.** It pinned "keeps
  every slice of one over-budget batch"; it now pins that an over-budget batch
  is evicted back down. That is the contract change, stated where someone will
  hit it.

- ADR 0004's other half — the raised default and the idle timeout — is
  unaffected, as is [ADR 0003](0003-abortsignal-on-the-read-path.md)'s abort
  plumbing and one-decode-per-slice sharing. Only the eviction policy changes.

## Evidence

Six-window 50kb pan and a repeated identical query, `held` against the stated
limit:

| `cacheSize` | corpus         | `'batch'`                         | `'lru'`                          |
| ----------- | -------------- | --------------------------------- | -------------------------------- |
| 20,000      | `200x` repeat  | 13ms, 0 refills, **held 90,000**  | 494ms, 21 refills, held 20,000   |
| 20,000      | `1000x` repeat | 67ms, 0 refills, **held 420,000** | 2431ms, 120 refills, held 20,000 |
| 20,000      | `1000x` pan    | 2615ms, 121 refills               | 5058ms, 243 refills              |
| 1,000,000   | `200x` repeat  | 26ms, 0 refills                   | 24ms, 0 refills                  |
| 1,000,000   | `200x` pan     | 57ms, 0 refills                   | 60ms, 0 refills                  |
| 1,000,000   | `1000x` repeat | 132ms, 0 refills                  | 75ms, 0 refills                  |
| 1,000,000   | `1000x` pan    | 228ms, 4 refills                  | 228ms, 4 refills                 |

Two things fall out. At the shipped budget the policies are **identical** — same
refill counts, times inside noise. At the old budget `'batch'` wins enormously,
and holds **21x its stated limit** to do it.

## Note for @gmod/shared-read-cache

`'batch'` was this package's only consumer of that policy. It stays in the
package as a documented option, but its doc comment should no longer read as a
recommendation on cram's authority: what cram learned is that it rescues an
undersized budget by exceeding it, and that a budget above the working set is
the better fix.
