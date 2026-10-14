# 0003 — Cancel per-query reads, reference-count the shared ones

**Status:** accepted — the file-wide reads now take the signal too (see below)

## Context

`getRecordsForRange` accepted no `signal`. Only `IndexOpts` — the `.crai`
download — did, so a cancelled query kept downloading its slice data to
completion and then threw it away. jbrowse-components threads a
stop-token-derived signal into `@gmod/bam`, `@gmod/tabix` and `@gmod/bbi`
already; CRAM was the one indexed format left out.

The slice reads are larger than "index reads are short" suggests, because the
caller's byte-range layer coalesces contiguous chunks into one range request, so
a small viewport over deep data becomes a single large read.

The read path is a stack of **self-clearing memoized promises**:
`getDefinition`, `getCompressionScheme`, `getHeader`,
`_getBlocksContentIdIndex`, then `SliceRecordCache`. Each of them already drops
a rejected promise, so a cancellation cannot _poison_ a cache, and
`SliceRecordCache` documents that hazard. A naive signal causes a different
problem, because a memo cannot tell **whose** cancellation it is seeing. With a
signal threaded in naively, a query that joins a read started by a cancelled
query fails with that query's cancellation. A retry would succeed, since the
memo dropped the entry, but no code retries, so the query fails because of an
abort that was not its own.

## Decision

Split the read path by **who owns the read**, and handle each half differently.

**Per-query reads take the signal.** `CramContainer` and `CramSlice` are
constructed fresh for every query (`getContainerAtPosition` and `getSlice` build
one rather than looking one up), so their memos are private to a single query
and every caller of one is the same query with the same signal. Those memos take
the signal directly, now that `memoizeAsync` has been generalized to allow it
(first caller's arguments win, documented there as safe only for arguments that
cannot change the result). Most of the bytes come from these reads, since
`_fetchBlocks` issues the slice's whole payload in one read.

The per-query set deliberately includes `getHeader` and
`_getBlocksContentIdIndex`, which an earlier sketch of this work proposed
excluding as "shared file-wide". They are not shared file-wide in this codebase,
and `_getBlocksContentIdIndex` sits directly on top of the bulk read — excluding
it would have left the change with nothing to cancel.

**File-wide reads are reference-counted too.** `_definitionMemo` and
`_samHeaderMemo` are fetched once for the life of the `CramFile` — 26 bytes of
definition, and the first container for the SAM header.

The file-wide reads first shipped as "file-wide reads do not carry the signal",
on the grounds that every query after the first joins them already resolved, so
cancelling them would save no bytes. That reasoning missed the read that comes
before any query. jbrowse's `CramAdapter` setup calls `getSamHeader()` on its
own, and a setup abandoned mid-read kept reading the definition, the first
container header and its first block. The original worry was that the first
query to arrive would own a read the whole file depends on. Both memos now go
through `memoizeShared`, a one-key `SharedReadCache` (the mechanism behind the
slice cache below), so no single caller owns the read. The read aborts only once
every caller waiting on it has aborted, and a caller with no signal pins it.

**The decoded slice is reference-counted.** `SliceRecordCache` is shared between
concurrent queries, so its decode runs under a per-entry `AbortController`
instead of any one caller's signal. The controller aborts only once **every**
consumer that joined has itself aborted. The cache reports a caller's own abort
to that caller alone, by re-checking the caller's signal after the shared
promise settles. A cancellation therefore cannot leak between queries, because
the cache cancels a decode only when no consumer still wants it.

A consumer with **no signal can never abort**, so it pins the entry, and no
combination of other aborts stops the decode. A caller that never asks to be
cancellable should expect that. We therefore thread the signal all the way down
instead of dropping it anywhere convenient, because one signal-free join makes
that slice uncancellable for everyone on it.

Ref-counting is the model `@gmod/abortable-promise-cache` gives `@gmod/tabix`
and `@gmod/bbi`. cram-js implements it instead of taking the package as a
dependency, because that package has to own the cache, and `SliceRecordCache` is
not a plain LRU: its record-count bound weighs each entry when the entry's
promise resolves, so the cache has to own its entries. Two smaller reasons argue
against adopting it: its aggregator never clears `signals` or removes its
listeners once an entry settles, which would make a cached slice retain every
consumer signal that ever joined it, and cram-js deliberately dropped the
dependency in `61791ba`.

**`CraiIndex` keeps a bounded retry instead**, because the trade is different
there. When the caller that started the index parse aborts, a caller that joined
the parse retries once, and any failure after that propagates. `CraiIndex`
parses the `.crai` once for the life of the object, so there is no repeated
waste to recover, and the retry is a dozen lines against restructuring the memo.
jbrowse's `RemoteFileWithRangeCache.joinChunk` bounds the same retry the same
way, one layer down, on 256 KiB chunks, and for the reason it gives: the
pathological case becomes one duplicate parse rather than a recursion whose
depth depends on how the aborts interleave. `@gmod/bam` recurses without a
bound, and cram-js does not copy that part of the pattern.

### What this replaced, and why

The first version of this work ref-counted nothing. The decode ran under
whichever caller started it. When that caller aborted, a caller that had joined
saw the decode fail and retried under its own signal. That version was correct,
and the tests below check exactly the same cross-query properties, but it threw
away work in the case that matters most, a pan in jbrowse.

A pan in jbrowse cancels the query in flight while the next query wants most of
the same slices. Slices the cancelled query had already finished are resolved in
the cache, and the new query reads them from there with no further work. The new
query joined the slices still decoding, so the retry decoded those twice on
every pan, whereas ref-counting keeps them running. The byte-range cache
underneath would have served the re-read cheaply, but the inflate and record
decode are the expensive part, and the byte-range cache does not help with
those.

The retry also had a flaw that the ref-count avoids. Because the retry was
bounded at one attempt, a third query could inherit an abort it never asked for,
if the caller it retried into also gave up.

**The code checks the signal explicitly at each boundary**, not just at the
filehandle. A filehandle may ignore the signal: `RemoteFile` hands it to
`fetch`, but `LocalFile` ignores it and every read runs to completion.
`CramFile.read` therefore checks before issuing a read, and `_fetchRecords`
checks again before the decode loop. That loop is synchronous across the whole
slice, which is tens of thousands of records on short-read data, with no `await`
inside for an abort to interleave with.

### The invariant this rests on, and what it cost to keep

The whole first-caller-wins arrangement requires that "container and slice
objects are per-query". Before this work, the same invariant also caused a lot
of duplicate reading, because every slice of a query built its own
`CramContainer`. Each container's header and compression header block were
therefore re-read once per slice in the container.

The fix shares containers **across the slices of one query and no wider**,
through a `Map` built in `getRecordsForRange` and threaded into
`getRecordsInSlice`. Every caller of a shared container's memo is then still the
same query with the same signal, so the invariant holds. A file-level container
cache would break it by putting the first query's signal in charge of a header
every later query depends on, which is the leak this ADR handles explicitly at
the other two sites, at a third site with no handling. Anyone who later wants
containers cached file-wide has to solve that leak first.

## Consequences

- `getRecordsForRange` and `hasDataForReferenceSequence` accept `opts.signal`.
- `SeqFetch` takes a fifth argument, `opts`, so a callback backed by a remote
  sequence source can cancel too. The change is additive: a four-argument
  callback is unchanged, and a callback that ignores the signal only makes the
  query reject at the next point the decode checks, instead of at the fetch.
- `memoizeAsync` now forwards arguments, with a first-caller-wins rule that is
  only sound for arguments that cannot change the result. A later call passing
  different arguments gets the result cached for the first caller's arguments,
  with no warning, which is why the doc comment on it is longer than the
  function.
- `SliceRecordCache.set` became `getOrFill`, which takes a fill callback rather
  than a promise, because the cache creates the signal the decode runs under and
  therefore has to start the decode. A second `getOrFill` for a live key now
  joins rather than replacing, which is how the cache was always meant to
  behave.
- **A single signal-free query makes a slice's decode uncancellable for everyone
  joined to it.** That behavior is inherent to ref-counting and not a defect,
  but in a codebase where some callers pass a signal and others do not,
  cancellation stops working for the shared slices and raises no error.
  `test/sliceRecordCache.test.ts` pins the behavior so it stays deliberate.
- `getRecordsInSlice` takes an optional per-query container map. Omitting it is
  correct and costs one container's worth of re-reading per slice.
- Cancellation is best-effort about _bytes_, exact about _outcome_: the query
  always rejects, but whether bytes already in flight stop depends on the
  filehandle.

## Evidence

**Cross-query isolation is required, not defensive.** It was first built as a
retry, and reverting just the owner-aborted guards to a bare `throw e` failed
three of the eight tests in `test/abort.test.ts`: a bystander sharing a slice, a
bystander sharing the index parse, and a bystander with no signal at all. Those
three tests were written against the retry and **pass unchanged against the
ref-count**, so the two designs agree on the property and differ only in cost.
The same revert still fails the index-parse test, because `CraiIndex` still uses
a retry. `test/lib/gatedFile.ts` makes these tests deterministic. It honors the
signal, which `LocalFile` ignores, so the tests can observe an interrupted read,
and it parks reads on demand, so the tests do not race the filesystem.

**The ref-count stops the re-decode.**
`a cancelled query does not make a bystander re-read the slice` runs two
concurrent queries over the same 149 slices, cancels one mid-decode, and asserts
the survivor issues exactly the number of reads a solo query does — and that no
read was abandoned (`abortedReads === 0`). Under the retry the bystander re-read
every slice that was still in flight. `test/sliceRecordCache.test.ts` covers the
mechanism directly: one of two consumers aborting leaves the fill signal
unaborted, both aborting fires it, a signal-free consumer pins it, one signal
joining twice counts once, and an already-aborted caller never starts a fill at
all.

**Sharing containers within a query removed every duplicate read.** We measured
a cold `getRecordsForRange(0, 0, 200)` over ce#1000 (1000 records, 149 slices
across ~30 containers) at the `CramFile`→filehandle boundary:

|                               | before  | after       |
| ----------------------------- | ------- | ----------- |
| filehandle reads              | 1001    | **545**     |
| distinct `(length, position)` | 545     | **545**     |
| bytes read                    | 200,851 | **145,161** |

The file is 141,134 bytes, so the query went from reading 1.42x it to 1.03x, and
the duplicate reads went to zero. All 456 repeats had been container headers
re-read once per slice. `test/redundantReads.test.ts` pins both results.

The query still makes 545 reads at 373 distinct positions. 172 of them are
`readBlock` probing a block header and then re-reading it as part of the full
block, which is an open TODO item outside this ADR.

**The ref-count introduced a retention bug.** We record it here because it is
the same bug this ADR criticises `@gmod/abortable-promise-cache` for.
`getOrFill` joined every consumer to the entry, including consumers arriving
after it had settled. A settled entry has already taken its abort listeners back
off its consumers' signals, so a signal registered after that point could never
be unregistered: it sat in the entry's set for as long as the LRU held the
slice, holding that query's `AbortController` with it. Every cache _hit_ leaked
one, on exactly the path that is supposed to be cheap. Only a decode still
running has anything to cancel, so the fix stops `getOrFill` from joining a
consumer to a settled entry.
`a hit on a settled slice does not retain the caller` counts 50 hits and expects
zero retained; before the fix it counted 50.

The leaked consumers do not show in behavior: a settled entry with a thousand
stale signals answers every query exactly like one with none. That is why
`SliceRecordCache.consumerCount` exists purely as a test seam. Reading the code
was the only check between this bug and shipping, and reading the code is how
the test got written.

**What sharing containers saves.** Over HTTP the saving is mostly not bytes.
jbrowse's `RemoteFileWithRangeCache` caches per 256 KiB chunk, and a container
header sits in the same chunk as the slices that follow it, so that cache was
already serving the duplicate reads. What they cost was a `Uint8Array`
allocation, a copy, and a synthesized `Response` **per read**, 1001 times.
Locally the saving is I/O, because `LocalFile.read` opens and closes the file
descriptor on every call.

**The size of the cancellation saving comes from BAM, not from a CRAM
measurement.** The 6.5 MiB figure that motivates this ADR was measured in
jbrowse on the analogous **BAM** path: one 4 kb viewport over a 2000x BAM issues
a single 6.5 MiB range read, and over a 4-hop pan burst throttled to 50 KiB/s,
three cancelled navigations abandoned ~6.5 MiB each. The same
`RemoteFileWithRangeCache` sits under both formats, so the order of magnitude
should be similar, but treat that as an expectation rather than a result until
someone runs it.

**The change does not alter what is decoded.** The full suite (217 files, 663
tests) passes unchanged, including the snapshot tests over all indexed fixtures.
When no signal is passed, this work changes neither the bytes read nor the
records produced.
