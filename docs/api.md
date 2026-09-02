# API reference

Everything the package exports, in detail. The [README](../README.md) is the
short version; start there if you have not read it.

All coordinates are **0-based half-open**.

## `IndexedCramFile`

```js
new IndexedCramFile({
  cramPath, // local path
  cramUrl, // remote URL
  cramFilehandle, // generic-filehandle2 compatible handle
  index, // CraiIndex, or anything with getEntriesForRange
  fetchReferenceSequence, // async (seqId, start, end, refName, opts) => string
  checkSequenceMD5, // verify each slice's reference MD5. default false
  validateChecksums, // check block and container CRC32s. default false
  maxCacheBytes, // decoded bytes to keep. default 1 GB
  cacheIdleTimeoutMs, // drop slices unread for this long. default 3 minutes
  cacheBudget, // a SharedBudget, to pool maxCacheBytes across files
  useSliceWorkerPool, // decode slices on a worker pool. default true
  numSliceWorkers, // pool size. default min(hardwareConcurrency, 4)
})
```

- `getRecordsForRange(seqId, start, end, opts?)` → `Promise<CramRecord[]>`.
  `opts`:
  `{ viewAsPairs, pairAcrossChr, maxInsertSize, decodeTags, onProgress, signal }`
- `hasDataForReferenceSequence(seqId, opts?)` → `Promise<boolean>`
- `clearFeatureCache()` — drop every decoded slice now, rather than waiting out
  `cacheIdleTimeoutMs`. For a consumer that knows it is done with the file
- `cram` — the underlying `CramFile`

### Verifying the file

`validateChecksums` checks every block's and container's CRC32. It is what
separates "damaged file" from "wrong records": with it on, it catches a
corrupted byte anywhere in a CRAM 240 times out of 240, where with it off two of
those flips decoded to records that simply differed, with nothing to say so.

`checkSequenceMD5` is the other half of that, on the reference rather than the
file: it verifies each slice's recorded reference MD5 against the sequence
decoding it. Off by default because the check needs the slice's whole reference
span, which can be many megabases the query would not otherwise fetch.

### The cache options

`maxCacheBytes` bounds what the decoded-slice cache **retains**, in bytes. A
slice weighs what its columns hold — `DecodedSlice.byteLength`: the typed arrays
exactly, the strings by estimate — which comes to within 1–8% of the measured
heap on the fixtures here
([ADR 0013](adr/0013-weigh-the-slice-cache-in-bytes.md)). It is not a bound on
peak memory: reads in flight, the last settled entry, and every slice a query
holds until it returns all sit outside it, and the cache holds slices whole —
[memory.md](memory.md#the-slice-cache) has how far a query in flight may exceed
it.

Size it to hold several queries. Below one query's working set it does not cache
less, it caches _nothing_: every slice falls out before the next pan can reuse
it, so the hit rate is zero and the memory stays put anyway.

`cacheIdleTimeoutMs` is the only thing that lowers the cache while nothing is
happening — the cache checks `maxCacheBytes` when a decode settles, so an idle
one stays wherever it got to. The clock runs from the last _read_ of a slice, so
panning back and forth over one region never expires it. `0` disables it.

`cacheBudget` makes `maxCacheBytes` apply to several `CramFile`s together
instead of to each one, which is what a consumer opening a file per track needs.
It weighs in the same unit as `@gmod/bam`'s cache, so one budget can hold a
consumer's BAM and CRAM tracks together.

### The worker options

`useSliceWorkerPool` decodes slices on a shared pool where the host has workers,
and in-process where it does not. Leave it on inside your own worker too — a
worker is still one thread, and nested in one the pool measures 2.1-3.6x from
four slices up ([workers.md](workers.md)).

`numSliceWorkers` sizes that pool. One pool serves a whole JS context, so the
first file to need one fixes the size for the rest, and a host running several
worker contexts gets a pool in each.

### `recordClass`

A subclass of `CramRecord` to hand out from every query in place of the base
class. A consumer that keeps its own object per read — a feature — can make that
object the record itself rather than wrap one, which `@gmod/bam` offers under
the same name:

```js
class MyFeature extends CramRecord {
  get name() {
    return this.readName
  }
}
new IndexedCramFile({ ..., recordClass: MyFeature })
```

It is constructed as `new MyFeature(slice, index)`, the same way the base class
is; anything else it needs it reads off itself.

### Unplaced reads

Unplaced reads have no position at all and sort to the end of the file. Both
their `sequenceId` and their `start` are `-1`, so you ask for them like this:

```js
await indexedFile.getRecordsForRange(-1, -1, end) // a start of 0 finds nothing
```

Unmapped reads that a writer _placed_ at their mate's position are a different
case. They carry the mate's `sequenceId` and `start`, so an ordinary range query
finds them.

## Cancelling a query

Pass an `AbortSignal` as `opts.signal` and the query rejects, stops decoding,
and — on a filehandle that honors the signal, which `RemoteFile` does and
`LocalFile` does not — abandons the range request it has in flight:

```js
const controller = new AbortController()
const records = indexedFile.getRecordsForRange(0, 1000, 2000, {
  signal: controller.signal,
})
controller.abort() // `records` rejects with an AbortError
```

This is worth more than "index reads are short" suggests. A byte-range-caching
filehandle such as
[@gmod/range-cache-filehandle](https://github.com/GMOD/range-cache-filehandle)
coalesces adjacent reads into one request, so a small viewport over deep data
becomes a single multi-megabyte fetch — exactly the thing you want to drop when
the user pans away.

**Aborting your query never fails anyone else's.** Concurrent queries share two
things in a `CramFile`: the parsed `.crai`, and each decoded slice in the record
cache. A slice's decode carries a reference count and aborts only once _every_
query waiting on it has given up, so cancelling yours costs a concurrent query
nothing, not even a re-read. The file definition and SAM header load once for
the life of the object and deliberately take no signal at all.

The corollary: a query with **no** signal can never give up, so it pins any
slice it is waiting on. One caller omitting the signal makes that slice's decode
uncancellable for everyone sharing it — so thread the signal through
consistently rather than through the queries you happen to care about.

A `fetchReferenceSequence` backed by something remote receives the signal as a
fifth argument (`opts.signal`) so it can cancel too. Ignoring it is fine; a
four-argument callback keeps working unchanged.

Why it works this way: [ADR 0003](adr/0003-abortsignal-on-the-read-path.md).

## `CramFile`

Usually reached as `indexedFile.cram`, but you can also build one directly with
`new CramFile({ path, url, filehandle })`. No index needed, which is handy if
all you want is the header, or if you're walking containers yourself.

- `getReferenceInfo()` → `Promise<{ name, length, md5? }[]>` — the `@SQ` lines,
  in header order
- `getReferenceId(name)` → `Promise<number>` — throws if the header has no such
  `SN`
- `getReferenceName(refId)` → `Promise<string | undefined>`
- `getSamHeader()` → the parsed header as `{ tag, data: { tag, value }[] }[]`
- `getHeaderText()` → the raw header text

## `CraiIndex`

Takes `{ path, url, filehandle }` — pass exactly one of the three.

## `CramRecord`

A record is a **view**: the columns of its decoded slice (`record.slice`, a
`DecodedSlice`) and an index into them (`record.index`). Every property below
reads the column at that index, and the ones that can be assigned write through
to it. Views are handed out fresh by each query and are meant to be short-lived;
the slice's columns are what the cache holds and what a worker transfers. Build
one by hand with `new CramRecord({ ...fields })`, which wraps the fields in a
one-record slice.

### Properties

- `readName` — read name
- `sequenceId` — numeric reference ID
- `start` — 0-based start position; `-1` for an unplaced read
- `lengthOnRef` — reference bases the alignment covers, `undefined` for an
  unmapped read
- `nextSequenceId`, `nextStart` — where the next segment of the template is (SAM
  `RNEXT`/`PNEXT`). Test `hasNextPosition()` first
- `qualityScores` — `Uint8Array` of per-base quality scores, `null` for a `*`
  record, `undefined` when the file did not preserve them. Built on every access
  as a view over `qualityColumn` below, so pull it into a local rather than
  indexing it in a loop.
- `qualityScoreAt(pos)` — the score at a 0-based read position, or `-1` when the
  file has none. Reads straight out of the column, allocating nothing.
- `qualityColumn`, `qualityStart` — every quality score in the record's slice
  laid end to end, and this record's offset into it. Hoist these out of a
  per-base loop and index `qualityColumn[qualityStart + i]`.
- `getTag(name)` — one auxiliary tag's value, read straight out of the record's
  slots in the slice's tag column. **Prefer this whenever you want one tag**: it
  is 3.8–7.8x faster than going through `tags`, which has to build an object
  holding every tag on the read to answer for one.
- `tags` — every auxiliary tag as an object. Built from the column on first
  access and then cached, so repeat reads are free but the first one is not.
- `tagColumn`, `tagStart`, `tagCount` — the columnar storage the tags decode
  into, shared across every record in a slice, in the same shape as
  `readFeatureArena` below.
- `readFeatures` — the raw read features, as an array. Prefer `getMismatches()`;
  see [read-features.md](read-features.md) if you really do need this level. The
  array is rebuilt on every access, so pull it into a local rather than reading
  it in a loop condition.
- `readFeatureArena`, `readFeatureStart`, `readFeatureCount` — the columnar
  storage the features decode into, shared across every record in a slice.
  Reading these columns instead of `readFeatures` is what makes a bulk consumer
  fast: 3.7x on a long-read slice, at a fraction of the memory.

Read features and quality scores both live in one shared typed array per slice
rather than one per record, because a per-record `Uint8Array` costs ~104 bytes
in V8 — more than the quality scores of a short read. [memory.md](memory.md)
covers what a decoded slice retains, how to read these columns without
allocating, and what bounds the slice cache.

### Flag methods

The usual SAM flags (spec §1.4), all returning `boolean`.

- `isPaired()` — the read is paired, whether or not both segments mapped
- `isProperlyPaired()` — paired, and both segments mapped
- `isSegmentUnmapped()` — this read did not map
- `isMateUnmapped()` — the mate did not map
- `isReverseComplemented()` — mapped to the reverse strand
- `isMateReverseComplemented()` — the mate mapped to the reverse strand
- `isRead1()` / `isRead2()` — which segment of the pair this is
- `isSecondary()` — a secondary alignment
- `isSupplementary()` — a supplementary (chimeric) alignment
- `isFailedQc()` — flagged as failing quality control
- `isDuplicate()` — flagged as a PCR or optical duplicate
- `hasNextPosition()` — the file located the next segment of the template. Not
  the same question as `isPaired()`

### Methods

- `getReadBases()` → `string | null | undefined` — the read sequence, `null` for
  a record with no bases. Needs `fetchReferenceSequence`; `getRecordsForRange`
  applies the reference for you. Memoised on the slice, so a repeat query over
  cached data pays once.
- `getCigarString()` → `string` — the read's alignment (e.g. `"50M2I48M"`),
  reconstructed from the read features. Substitutions and mismatches come out as
  `M`, per the plain CIGAR convention. Unmapped reads, and mapped reads with no
  operations, return `"*"`. Does not require `fetchReferenceSequence`.
- `forEachCigarOp(callback)` — the same alignment reported to
  `callback(op, length)` one operation at a time, without building a CIGAR of
  any kind. `op` is one of the exported `CIGAR_MATCH`, `CIGAR_INS`, `CIGAR_DEL`,
  `CIGAR_REF_SKIP`, `CIGAR_SOFT_CLIP`, `CIGAR_HARD_CLIP`, `CIGAR_PAD` — the
  numbering the SAM spec gives them, so `(length << 4) | op` is BAM's packed
  form. The walk merges adjacent runs of the same op and drops zero-length ones.
  Reach for this whenever the answer is a measurement rather than text — a
  reference span, an op histogram, or the packed array BAM stores natively:

  ```js
  const packed = []
  record.forEachCigarOp((op, length) => {
    packed.push((length << 4) | op)
  })
  ```

  CRAM stores no CIGAR. Unlike BAM, where the packed array sits on disk and a
  reader can view it without copying, here it always comes back out of the read
  features — so this library hands out the walk rather than an array type it
  would have picked for you. See
  [ADR 0006](adr/0006-cigar-as-a-callback-walk.md).

- `getLeadingClipLength()` → `number` and `getTrailingClipLength()` → `number` —
  how many bases the **first** and **last** CIGAR operations clip, or 0 when
  they are not clips. Both read only the features at that end of the record, so
  they are O(1) where walking the CIGAR to look at one of its operations is
  O(operations), and a long read has thousands. Each reports that one operation
  and no more, so a `5H4S…10M…4S5H` read clips 5 at each end, not 9.

  Between them these answer "how much of this read is clipped, as sequenced":
  the leading clip for a forward-strand read and the trailing one for a
  reverse-strand read, since CRAM stores a reverse-strand read
  reverse-complemented.

- `getMismatches(opts?)` → `Mismatch[]` — every difference from the reference.
- `forEachMismatch(callback, opts?)` — the same differences, reported to
  `callback(code, refPos, length, bases, qual, refBaseCode, clipLength)` without
  allocating per difference.

  `opts` is `{ start, end, origin }`, all optional. `start`/`end` are a 0-based
  half-open **reference** range to restrict to; a spanning deletion or skip
  counts as inside it if any of its bases are. `origin` is what the reported
  positions are relative to — `origin: record.start` gives read-relative
  positions, and the default of 0 gives reference ones. The window stays
  absolute either way, so a read-relative consumer can still clip to a genomic
  viewport:

  ```js
  record.forEachMismatch(cb, { start, end, origin: record.start })
  ```

  `origin` is there so a consumer with its own coordinate convention can pass
  its own callback straight in. Converting positions afterwards needs a second
  callback in between, and that indirect call measured +17% of the walk — see
  [ADR 0008](adr/0008-emit-into-the-consumers-callback.md).

Both mismatch methods need `fetchReferenceSequence` configured before they can
tell you the actual bases involved in a substitution. Without it you still get
the substitution, at the right position, but its `bases` come back as `'N'` and
its `refBaseCode` as `0`.

One kind of file is worse off than that. A CRAM written with `no_ref` stores its
bases verbatim instead of working out which of them are substitutions, so
finding them means comparing against a reference — without one, those reads come
back with no substitutions at all rather than with vague ones. See
[optimizations.md](optimizations.md#no_ref-files-make-the-mismatch-walk-much-slower)
for what that comparison costs when you do have a reference.

- `getPairOrientation()` → `'F1R2'`-style string, or `undefined` for an unpaired
  read. Both halves of a pair always agree on it, including when the file does
  not locate the next segment.
- `toJSON()` — a plain object of the record, for dumping or serializing.

### CRAM-specific flags

Separate from the SAM flags above; these come from CRAM's own compression flags
(CRAM v3 §8.4) and matter mainly when you are reasoning about how a writer built
the file.

- `isDetached()` — the record stores its own mate information rather than
  pointing downstream
- `hasMateDownStream()` — its mate is later in the same slice
- `isPreservingQualityScores()` — the file kept per-base qualities for this read
- `isUnknownBases()` — the file stored no bases for this read (`getReadBases()`
  returns `null`)

## `Mismatch`

What `getMismatches()` returns, and the argument order `forEachMismatch` passes:

| Field         | Meaning                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `code`        | char code of `X` = substitution, `I` = insertion, `D` = deletion, `N` = reference skip, `S` = soft clip, `H` = hard clip |
| `refPos`      | 0-based reference position                                                                                               |
| `length`      | reference bases covered: 1 for a substitution, the deleted or skipped length for `D`/`N`, 0 for insertions and clips     |
| `bases`       | the substituted base, or the inserted bases; empty for `D`/`N`/`S`/`H`                                                   |
| `qual`        | quality of a substituted base, `-1` when the file does not store it                                                      |
| `refBaseCode` | char code of the reference base a substitution replaces, `0` when unknown                                                |
| `clipLength`  | read bases consumed: the inserted or clipped length, else 0                                                              |

Compare `code` against the exported `RF_SUBST`, `RF_INSERTION`, … constants.
Insertions arrive as `I` whether the file encoded them as `I` or as a run of
`i`.

## Read features

The raw CRAM encoding behind `record.readFeatures`, documented in
[read-features.md](read-features.md). You don't need it for mismatches.

## Error classes

- `CramUnimplementedError` — unimplemented spec feature
- `CramMalformedError` — malformed file data
- `CramBufferOverrunError` — read past end of data
