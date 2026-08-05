# 0003 — Cancel per-query reads, reference-count the shared ones

**Status:** accepted

## Context

`getRecordsForRange` accepted no `signal`. Only `IndexOpts` — the `.crai`
download — did, so a cancelled query kept downloading its slice data to
completion and then threw it away. jbrowse-components threads a
stop-token-derived signal into `@gmod/bam`, `@gmod/tabix` and `@gmod/bbi`
already; CRAM was the one indexed format left out.

This is worth more than "index reads are short" suggests. The caller's
byte-range layer coalesces contiguous chunks into one range request, so a small
viewport over deep data becomes a single large read.

The obstacle is that the read path is a stack of **self-clearing memoized
promises** — `getDefinition`, `getCompressionScheme`, `getHeader`,
`_getBlocksContentIdIndex`, then `SliceRecordCache`. Every one of them already
drops a rejection, so a cancellation cannot _poison_ a cache; `SliceRecordCache`
documents that hazard. That was never the problem.

The problem is that a memo has no way to tell **whose** cancellation it is
seeing. Thread a signal in naively and a query that happens to join a read
started by a cancelled query inherits that cancellation as its own failure. It
would succeed on a retry — the entry was dropped — but nothing retries, so it
fails for a reason that has nothing to do with it.

## Decision

Split the read path by **who owns the read**, and handle each half differently.

**Per-query reads carry the signal.** `CramContainer` and `CramSlice` are
constructed fresh for every query — `getContainerAtPosition` and `getSlice`
build one rather than looking one up — so their memos are private to a single
query and every caller of one is the same query carrying the same signal. Those
memos take the signal directly, which is what `memoizeAsync` was generalized to
allow (first caller's arguments win, documented there as safe only for arguments
that cannot change the result). This is where the bytes are: `_fetchBlocks`
issues the slice's whole payload in one read.

This deliberately includes `getHeader` and `_getBlocksContentIdIndex`, which an
earlier sketch of this work proposed excluding as "shared file-wide". They are
not shared file-wide in this codebase, and `_getBlocksContentIdIndex` sits
directly on top of the bulk read — excluding it would have left the change with
nothing to cancel.

**File-wide reads do not carry the signal.** `_definitionMemo` and
`_samHeaderMemo` are fetched once for the life of the `CramFile` — 26 bytes of
definition, and the first container for the SAM header — so every query after
the first joins them already resolved. Letting the first query to arrive own a
read the whole file depends on is wrong however carefully the sharing is
handled, and there is nothing to save.

**The decoded slice is reference-counted.** `SliceRecordCache` is shared between
concurrent queries, so its decode does not run under any one caller's signal. It
runs under a per-entry `AbortController` that aborts only once **every**
consumer that joined has given up; a caller's own abort is reported to that
caller alone, by re-checking it after the shared promise settles. A cancellation
therefore cannot leak between queries because nothing is cancelled until nobody
wants it.

A consumer with **no signal cannot give up**, so it pins the entry: there is no
longer any set of aborts that should stop the decode. That is the honest reading
of a caller that never asked to be cancellable, and it is why the signal is
threaded all the way down rather than dropped anywhere convenient — one
signal-free join makes that slice uncancellable for everyone on it.

This is the model `@gmod/abortable-promise-cache` gives `@gmod/tabix` and
`@gmod/bbi`. It is implemented here rather than taken as a dependency because
that package wants to own the cache, and `SliceRecordCache` is not a plain LRU:
the record-count bound has to weigh each entry when its promise resolves, which
means owning the entries. Two smaller reasons not to adopt it — its aggregator
never clears `signals` or removes its listeners once an entry settles, so a
cached slice would retain every consumer signal that ever touched it, and
cram-js deliberately dropped the dependency in `61791ba`.

**`CraiIndex` keeps a bounded retry instead**, because the trade is different
there. A caller that joined the index parse and saw it fail because the caller
who started it aborted goes round once more, then propagates. The `.crai` is
parsed once for the life of the object, so there is no repeated waste to
recover, and the retry is a dozen lines against restructuring the memo. Bounding
it at one attempt is what jbrowse's `RemoteFileWithRangeCache.joinChunk` does
with the same retry one layer down, on 256 KiB chunks, and for the reason it
gives: the pathological case becomes one duplicate parse rather than a recursion
whose depth depends on how the aborts interleave. `@gmod/bam` recurses
unbounded, which is the part of that pattern not worth copying.

### What this replaced, and why

The first version of this work ref-counted nothing. The decode ran under
whichever caller started it, and a caller that joined and saw it fail because
that caller aborted retried under its own signal. It was correct — the tests
below pin exactly the same cross-query properties — but it threw away work in
the case that matters most.

A pan in jbrowse cancels the query in flight while the next query wants most of
the same slices. Slices the cancelled query had already finished are resolved in
the cache and the new query gets them free; slices still decoding are the ones
it joined, so those got decoded twice, every pan. Ref-counting keeps them. The
byte-range cache underneath would have served the re-read cheaply, but the
inflate and record decode are the expensive part and it does not help with
those.

The retry also had a wart the ref-count does not: bounded at one attempt, a
third query could inherit an abort it never asked for, if the caller it retried
into also gave up.

**An explicit check at each boundary**, not just at the filehandle. Honouring
the signal is optional down there: `RemoteFile` hands it to `fetch`, but
`LocalFile` ignores it and every read runs to completion. So `CramFile.read`
checks before issuing, and `_fetchRecords` checks again before the decode loop —
which is synchronous across the whole slice, tens of thousands of records on
short-read data, with no `await` inside for an abort to interleave with.

### The invariant this rests on, and what it cost to keep

"Container and slice objects are per-query" is load-bearing for the whole
first-caller-wins arrangement, and it was also, before this work, the source of
a lot of duplicate reading: every slice of a query built its own
`CramContainer`, so each container's header and compression header block were
re-read once per slice it held.

The fix is to share containers **across the slices of one query and no wider** —
a `Map` built in `getRecordsForRange` and threaded into `getRecordsInSlice`.
Every caller of a shared container's memo is then still the same query with the
same signal, so the invariant survives. A file-level container cache would not:
it would put the first query's signal in charge of a header every later query
depends on, which is exactly the leak handled explicitly at the other two sites,
reappearing at a third with nothing to handle it. If someone later wants
containers cached file-wide, that is the thing to solve first.

## Consequences

- `opts.signal` on `getRecordsForRange` and `hasDataForReferenceSequence`.
- `SeqFetch` takes a fifth argument, `opts`, so a callback backed by a remote
  sequence source can cancel too. Additive: a four-argument callback is
  unchanged, and ignoring the signal only means the query rejects at the next
  point the decode checks rather than at the fetch.
- `memoizeAsync` now forwards arguments, with a first-caller-wins rule that is
  only sound for arguments that cannot change the result. That is a footgun, and
  the reason the doc comment on it is longer than the function.
- `SliceRecordCache.set` became `getOrFill`, which takes a fill callback rather
  than a promise — the cache has to create the signal the decode runs under, so
  it has to be the thing that starts it. A second `getOrFill` for a live key now
  joins rather than replacing, which is what the cache always meant.
- **A single signal-free query makes a slice's decode uncancellable for everyone
  joined to it.** Inherent to ref-counting, not a defect, but it means
  cancellation degrades quietly in a mixed codebase rather than failing loudly.
  `test/sliceRecordCache.test.ts` pins it so it stays deliberate.
- `getRecordsInSlice` takes an optional per-query container map. Omitting it is
  correct, just one container's worth of re-reading per slice.
- Cancellation is best-effort about _bytes_, exact about _outcome_: the query
  always rejects, but whether bytes already in flight stop depends on the
  filehandle.

## Evidence

**Cross-query isolation is load-bearing, not defensive.** It was first built as
a retry, and reverting just the owner-aborted guards to a bare `throw e` failed
three of the eight tests in `test/abort.test.ts`: a bystander sharing a slice, a
bystander sharing the index parse, and a bystander with no signal at all. Those
three tests were written against the retry and **pass unchanged against the
ref-count**, which is the check that the two designs agree on the property and
differ only in cost. The same revert still fails the index one, which is still a
retry. `test/lib/gatedFile.ts` is what makes any of it deterministic — it
honours the signal (`LocalFile` does not, so nothing would otherwise observe an
interrupted read) and parks reads on demand, so the tests are not racing the
filesystem.

**The ref-count is what stops the re-decode.**
`a cancelled query does not make a bystander re-read the slice` runs two
concurrent queries over the same 149 slices, cancels one mid-decode, and asserts
the survivor issues exactly the number of reads a solo query does — and that no
read was abandoned (`abortedReads === 0`). Under the retry the bystander re-read
every slice that was still in flight. `test/sliceRecordCache.test.ts` covers the
mechanism directly: one of two consumers aborting leaves the fill signal
unaborted, both aborting fires it, a signal-free consumer pins it, one signal
joining twice counts once, and an already-aborted caller never starts a fill at
all.

**Sharing containers within a query removed every duplicate read.** A cold
`getRecordsForRange(0, 0, 200)` over ce#1000 — 1000 records, 149 slices across
~30 containers — measured at the `CramFile`→filehandle boundary:

|                               | before  | after       |
| ----------------------------- | ------- | ----------- |
| filehandle reads              | 1001    | **545**     |
| distinct `(length, position)` | 545     | **545**     |
| bytes read                    | 200,851 | **145,161** |

The file is 141,134 bytes, so the query went from reading 1.42x it to 1.03x, and
the duplicate population went to zero — the 456 repeats were entirely container
headers re-read once per slice. `test/redundantReads.test.ts` pins both.

What remains is 545 reads at 373 distinct positions: 172 are `readBlock` probing
a block header and then re-reading it as part of the full block, which is the
open TODO item, not this one.

**Where that win actually lands.** Over HTTP it is mostly not bytes. jbrowse's
`RemoteFileWithRangeCache` caches per 256 KiB chunk, and a container header sits
in the same chunk as the slices that follow it, so the duplicate reads were
already being served from that cache — what they cost was a `Uint8Array`
allocation, a copy, and a synthesized `Response` **per read**, 1001 times.
Locally it is I/O: `LocalFile.read` opens and closes the file descriptor on
every call.

**The size of the win is inherited, not measured here.** The 6.5 MiB figure that
motivates this was measured in jbrowse on the analogous **BAM** path: one 4 kb
viewport over a 2000x BAM issues a single 6.5 MiB range read, and over a 4-hop
pan burst throttled to 50 KiB/s, three cancelled navigations abandoned ~6.5 MiB
each. Nobody has measured CRAM. The same `RemoteFileWithRangeCache` sits under
both, so the order of magnitude should carry, but treat that as an expectation
rather than a result until someone runs it.

**No effect on what is decoded.** The full suite — 217 files, 663 tests — passes
unchanged, including the snapshot tests over all indexed fixtures. Nothing about
this changes the bytes read or the records produced when no signal is passed.
