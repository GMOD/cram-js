# 0009 — One pool per JS context, sized for the host

**Status:** accepted

## Context

The slice pool ([workers.md](../workers.md)) is memoized in module state, so it
is shared **per JS context** — one per worker, one on the main thread. That is
the scope `@gmod/bgzf-filehandle` chose for its inflate pool and the scope
jbrowse's `util/bgzfWorkerPool.ts` documents for the same reason: a track's
queries are sticky to one RPC worker, so without a pool everything decodes on
that one thread while the rest of the machine idles.

A pool per context is not a pool per machine, and the difference matters in
jbrowse. jbrowse gives each track its own `rpcSessionId` and round-robins those
over up to five RPC workers, so five CRAM tracks sit in five contexts and start
five pools. At the library default of `min(hardwareConcurrency, 4)` that is 20
slice workers, not 4. A context that also holds a bgzip-backed track has another
four from the inflate pool, and no code coordinates the two pools.

The extra workers cost time, but only on machines with too few cores to run
them. We timed the slowest track, because a pan is not done until every track
has drawn, on jb2bench's 19 kb region at 1000x short-read coverage, best of 4
reps:

|            | 4 cores | 4 cores | 16 cores | 16 cores |
| ---------- | ------- | ------- | -------- | -------- |
| **tracks** | pool 4  | pool 2  | pool 4   | pool 2   |
| 1          | 220 ms  | 241 ms  | 148 ms   | 203 ms   |
| 3          | 669 ms  | 498 ms  | 259 ms   | 304 ms   |
| 5          | 1347 ms | 956 ms  | 484 ms   | 471 ms   |

Four wins everywhere on 16 cores and loses badly on 4 from three tracks up —
**1.41x at five tracks**.

## The alternative that exists

`@gmod/bgzf-filehandle` already ships the other design: `BgzfWorkerPoolHost` and
`BgzfWorkerPoolClient` put one pool in one context and let the others reach it
over a `MessagePort`. The client implements the pool interface, so callers
cannot tell it from a local pool. It is exported, and it is covered by an
automated puppeteer test
(`MessagePort shared pool across simulated RPC workers`). No consumer has
adopted it; jbrowse calls `getSharedWorkerPool()` per context.

The host/client design bounds the total worker count by construction, which
conservative sizing does not. The question is what the extra boundary costs.

## Decision

**Keep the pool per context, and let the host size it** — `numSliceWorkers`,
which jbrowse now sets from the core count. Do not adopt a cross-context pool
here, and do not delete the machinery in `bgzf-filehandle` that implements one.

## Evidence

The first argument written against a cross-context pool was that relaying whole
decoded slices through a host would be too expensive, and **that was wrong**. We
measured it with a payload shaped like `sliceTransfer.ts`: typed arrays, which
transfer at zero copy, plus the read names, which are strings and so are cloned
at every hop. The table shows the round trip, interleaved, fastest of 9:

| records/slice | direct  | relayed | extra (2 hops) |
| ------------- | ------- | ------- | -------------- |
| 2,400         | 0.7 ms  | 1.5 ms  | 0.8 ms         |
| 9,600         | 2.5 ms  | 5.2 ms  | 2.7 ms         |
| 38,000        | 10.7 ms | 25.6 ms | 14.9 ms        |

A 1000x.shortread query is 16 slices of ~9,600 records, so a hosted pool would
add ~43 ms to a 256 ms pooled query. That is about **17%**, not the
disqualifying figure the first argument asserted. Long reads pay less, because
their per-record data is in the typed arrays, which transfer, and there are few
names to clone.

The relay is affordable, so the decision rests on **where each design puts its
cost**:

- A hosted pool charges ~17% on _every_ query, including the one- and two-track
  case that is most of the use, to fix contention that only appears at three or
  more tracks on a machine with few cores.
- Sizing charges nothing when there is no contention. At 16 cores the value is
  unchanged from the default; at 4 cores one track pays 220 → 241 ms so that
  five tracks gain 1347 → 956 ms.

The measured contention (1.41x) is larger than the measured relay (1.17x), so a
hosted pool would win at five tracks on four cores. It would lose in every other
configuration, and those configurations cover most use.

## Consequences

- **`numSliceWorkers` had to become reachable first.** It was documented from
  13.1.0 and dropped by `IndexedCramFile`, so this decision was unimplementable
  until 13.2.0 — see the note in [workers.md](../workers.md).
- **The sizing rule belongs in the consumer, not here.** This library cannot
  know how many contexts a host runs; jbrowse can, and does. The default stays
  `min(hardwareConcurrency, 4)`, which is right for a consumer with one context.
- **The total across libraries has no bound.** A context with a CRAM track and a
  bgzip-backed track runs two independent pools with no coordination between
  them. Sizing each pool down is a local fix for a shared-accounting problem.
  jbrowse solved the same kind of problem for memory in `util/cacheBudgets.ts`,
  where per-file ceilings multiplied by the track count had bounded nothing. A
  per-context worker budget is the natural next step, and this ADR does not take
  it.
- **Do not delete `BgzfWorkerPoolHost`/`Client` as dead code.** The pair is
  tested and works. This ADR explains why it has no consumer, and is not
  evidence that it should have none. It was nearly removed once, on the mistaken
  grounds that no code exercised it.
- **Reopen this if the tradeoff shifts.** The two numbers that decide it are the
  relay cost and the contention, and the crossover is not far away. More RPC
  contexts, deeper default track counts, or a payload with fewer strings would
  all move it toward the hosted pool. Re-measure both rather than re-arguing.

## Measurement caveats

The contention figures come from a harness that reproduces jbrowse's context
layout — N workers, each with its own pool, decoding the same region at once —
rather than from jbrowse itself, so the ratios are more trustworthy than the
absolute numbers. Core counts of 4 and 16 were tested; 8 is interpolated, and
the sizing rule is bounded by the two measured points at either end. The relay
figures come from a synthetic payload, not a real `SliceTransfer`, sized from
the record counts in [workers.md](../workers.md).
