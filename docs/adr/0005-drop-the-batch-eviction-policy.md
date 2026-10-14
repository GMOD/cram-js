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
measured. That removed the premise `'batch'` was adopted under, so we measured
the policy again instead of assuming it was still needed.

`'batch'` defers eviction until no reads are in flight and then **spares
everything the batch touched**. When a batch touches more than the whole budget,
the cache stays over the budget. That is the documented trade, and it is how
`'batch'` rescues a too-small budget: it exceeds the budget.

## Decision

Use `'lru'`, the package default. The cache then evicts down to `cacheSize`.

## Consequences

- **Real consumers see no change.** jbrowse's `CramAdapter` never passes
  `cacheSize`, so it takes the default, where the table below shows the two
  policies performing the same. The only code affected is a consumer that
  explicitly sets a small budget.

- **For that consumer, this is the fix rather than the regression.** Setting
  `cacheSize: 20000` is a request to constrain memory. Under `'batch'` the cache
  answered that request by holding 420,000 records. A query that runs slower
  than you hoped is a worse but honest outcome, and better than holding 21x the
  memory you asked for, particularly in a browser, where that much memory kills
  the tab.

- **The change gives up one case.** When a single query's working set exceeds
  the budget, `'lru'` evicts within the query and the repeat re-decodes. That is
  the pathology `'batch'` was adopted against, and it is now reachable only
  above 1,000,000 records. The fix there is a bigger `cacheSize`, not a policy
  that ignores it. @gmod/bam reached the same conclusion from the other
  direction, when it measured `'batch'` failing to rescue an undersized budget
  at all on a pan workload (identical refills, 1.7x worse on memory: @gmod/bam
  ADR 0013).

- **`test/sliceRecordCache.test.ts` flipped an assertion.** It pinned "keeps
  every slice of one over-budget batch"; it now pins that the cache evicts an
  over-budget batch back down. The assertion records the contract change where
  anyone changing the eviction policy will run into it.

- The raised default and the idle timeout from ADR 0004 are unaffected, as are
  [ADR 0003](0003-abortsignal-on-the-read-path.md)'s abort plumbing and
  one-decode-per-slice sharing, because only the eviction policy changes.

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

At the shipped budget the policies are **identical**, with the same refill
counts and times inside noise. At the old budget `'batch'` wins enormously, and
holds **21x its stated limit** to do it.

## Note for @gmod/shared-read-cache

cram-js was the only consumer of the `'batch'` policy. The policy stays in
@gmod/shared-read-cache as a documented option, but its doc comment should no
longer read as a recommendation on cram's authority: this ADR shows that it
rescues an undersized budget by exceeding it, and that a budget above the
working set is the better fix.
