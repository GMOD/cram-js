# API reference

Every coordinate in this API is 0-based half-open. The [README](../README.md)
has a quick start.

- [`IndexedCramFile`](#indexedcramfile): open a file and query a region
- [`CramFile`](#cramfile): the header and reference names
- [`CraiIndex`](#craiindex)
- [`CramRecord`](#cramrecord): one alignment
- [`Mismatch`](#mismatch): one difference from the reference
- [Errors](#errors)

## `IndexedCramFile`

```js
const indexedFile = new IndexedCramFile({
  cramUrl: 'https://example.com/file.cram',
  index: new CraiIndex({ url: 'https://example.com/file.cram.crai' }),
  fetchReferenceSequence: (seqId, start, end, refName) =>
    fasta.getSequence(refName, start, end),
})
```

### Options

| Option                   | Default                       | Description                                                                     |
| ------------------------ | ----------------------------- | ------------------------------------------------------------------------------- |
| `cramUrl`                |                               | URL of the CRAM file                                                            |
| `cramPath`               |                               | local path of the CRAM file                                                     |
| `cramFilehandle`         |                               | a [generic-filehandle2](https://github.com/GMOD/generic-filehandle2) handle     |
| `index`                  | required                      | a `CraiIndex`, or any object with `getEntriesForRange`                          |
| `fetchReferenceSequence` |                               | returns reference bases; see [Reference sequence](#reference-sequence)          |
| `checkSequenceMD5`       | `false`                       | verify each slice's reference MD5 against the bases the callback returns        |
| `validateChecksums`      | `false`                       | check the CRC32 of every block and container                                    |
| `maxCacheBytes`          | 1 GB                          | bytes of decoded slices to keep; see [Cache](#cache)                            |
| `cacheIdleTimeoutMs`     | 3 minutes                     | drop a slice nothing has read for this long; `0` disables                       |
| `cacheBudget`            |                               | a budget shared with other files, so `maxCacheBytes` bounds their total         |
| `useSliceWorkerPool`     | `true`                        | decode slices on a worker pool in a browser; see [workers.md](workers.md)       |
| `numSliceWorkers`        | `min(hardwareConcurrency, 4)` | size of the worker pool                                                         |
| `recordClass`            | `CramRecord`                  | a `CramRecord` subclass to return from queries; see [recordClass](#recordclass) |

Pass one of `cramUrl`, `cramPath` and `cramFilehandle`.

### Methods

| Method                                           | Returns                 | Description                                                     |
| ------------------------------------------------ | ----------------------- | --------------------------------------------------------------- |
| `getRecordsForRange(refName, start, end, opts?)` | `Promise<CramRecord[]>` | records overlapping the range; `[]` for a name the file lacks   |
| `hasDataForReferenceSequence(refName, opts?)`    | `Promise<boolean>`      | whether the index has any slice for the reference               |
| `clearFeatureCache()`                            |                         | drop every decoded slice now, for a consumer done with the file |
| `cram`                                           | `CramFile`              | the underlying [`CramFile`](#cramfile)                          |

`refName` is the name in the file's header, such as `chr1`. Both methods also
accept the numeric reference id; see [Reference ids](#reference-ids).

`getRecordsForRange` options:

| Option          | Default  | Description                                                              |
| --------------- | -------- | ------------------------------------------------------------------------ |
| `signal`        |          | an `AbortSignal`; see [Cancelling a query](#cancelling-a-query)          |
| `onProgress`    |          | `(bytesDownloaded, totalBytes) => void`, called as each slice is fetched |
| `decodeTags`    | `true`   | `false` skips decoding auxiliary tags, and `tags` is then empty          |
| `viewAsPairs`   | `false`  | also fetch the mate of each read whose mate lies outside the range       |
| `pairAcrossChr` | `false`  | with `viewAsPairs`, also fetch mates on other references                 |
| `maxInsertSize` | `200000` | with `viewAsPairs`, skip mates farther away than this                    |

### Reference sequence

CRAM stores each read as its differences from the reference, so decoding a
read's bases takes the reference sequence. `fetchReferenceSequence` receives
`(seqId, start, end, refName, { signal })` and returns the `end - start` bases
of that range. A longer string throws, and the library pads a shorter one with
`N`.

Without the callback, records have positions, CIGAR strings, and the type and
length of each difference, but no bases, and the mismatch methods give each
substitution the base `N`. The library decodes a file written with `embed_ref=1`
fully without the callback. A file written with `no_ref` stores bases verbatim,
so without a reference the library finds no substitutions in its reads.

### Reference ids

CRAM numbers each reference by the position of its `@SQ` line in the header, and
`record.sequenceId` holds that number.
`cram.getReferenceName(record.sequenceId)` returns the name.

Unplaced reads have a `sequenceId` and `start` of `-1` and no name, so you query
them by number, starting at `-1`:

```js
await indexedFile.getRecordsForRange(-1, -1, end)
```

An unmapped read placed at its mate's position has the mate's `sequenceId` and
`start`, so `getRecordsForRange` returns it for a range that covers that
position.

### Cancelling a query

```js
const controller = new AbortController()
const records = indexedFile.getRecordsForRange('chr1', 1000, 2000, {
  signal: controller.signal,
})
controller.abort() // `records` rejects with an AbortError
```

On abort, the query stops decoding and rejects. A filehandle that supports
signals, such as `RemoteFile`, also cancels its request in flight.

Concurrent queries share slice decodes and the header read, and the library
cancels a shared read only when every query waiting on it has aborted, so
aborting one query leaves the others running. A query without a signal cannot
abort, so a decode it shares runs to completion for everyone, which is why every
query should pass the signal. The library also passes it to
`fetchReferenceSequence`, and
[ADR 0003](adr/0003-abortsignal-on-the-read-path.md) explains the design.

### Cache

The library keeps decoded slices so that a later query over the same region
skips the decode. `maxCacheBytes` bounds the bytes the cache keeps, not peak
memory: slices a query is still using sit outside it. Size it to hold several
queries, because a cache smaller than one query's slices evicts each slice
before the next query can reuse it. [memory.md](memory.md#the-slice-cache) has
the details.

`cacheIdleTimeoutMs` empties the cache of slices that no query has read
recently. The library checks `maxCacheBytes` only when a decode finishes, so
while the file sits idle, the library frees memory only when the timeout
expires.

### `recordClass`

Queries return instances of this `CramRecord` subclass instead of `CramRecord`,
so a consumer can add methods to the record instead of wrapping it. The library
constructs it as `new MyFeature(slice, index)`, the same arguments the record's
`slice` and `index` properties hold. `@gmod/bam` takes the same option.

```js
class MyFeature extends CramRecord {
  get name() {
    return this.readName
  }
}
new IndexedCramFile({ ...options, recordClass: MyFeature })
```

## `CramFile`

`indexedFile.cram`, or `new CramFile({ url, path, filehandle })` to read a
header without an index. Each method takes an optional `{ signal }`.

| Method                 | Returns                                      | Description                                 |
| ---------------------- | -------------------------------------------- | ------------------------------------------- |
| `getReferenceInfo()`   | `Promise<{ name, length, md5? }[]>`          | the `@SQ` lines, in header order            |
| `getReferenceName(id)` | `Promise<string \| undefined>`               | the name for a numeric reference id         |
| `getReferenceId(name)` | `Promise<number>`                            | the numeric id for a name; throws if absent |
| `getSamHeader()`       | `Promise<{ tag, data: { tag, value }[] }[]>` | the parsed SAM header                       |
| `getHeaderText()`      | `Promise<string>`                            | the SAM header text                         |

## `CraiIndex`

`new CraiIndex({ url })`, or `{ path }` or `{ filehandle }`.

## `CramRecord`

### Properties

| Property                      | Type                              | Description                                                                         |
| ----------------------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| `readName`                    | `string`                          | read name                                                                           |
| `sequenceId`                  | `number`                          | numeric reference id; `-1` for an unplaced read                                     |
| `start`                       | `number`                          | 0-based start; `-1` for an unplaced read                                            |
| `end`                         | `number`                          | 0-based exclusive end, at least `start + 1`                                         |
| `lengthOnRef`                 | `number \| undefined`             | reference bases the alignment covers; `undefined` when unmapped                     |
| `mappingQuality`              | `number \| undefined`             | mapping quality                                                                     |
| `flags`                       | `number`                          | SAM flags; see [Flag methods](#flag-methods)                                        |
| `cramFlags`                   | `number`                          | CRAM compression flags; see the CRAM-specific [flag methods](#flag-methods)         |
| `readLength`                  | `number`                          | read length in bases                                                                |
| `readGroupId`                 | `number`                          | index of the read's `@RG` line; `-1` for none                                       |
| `uniqueId`                    | `number`                          | an id unique to the record within the file                                          |
| `nextSequenceId`, `nextStart` | `number`                          | position of the next segment (SAM `RNEXT`, `PNEXT`); test `hasNextPosition()` first |
| `templateLength`              | `number \| undefined`             | template length (SAM `TLEN`), computed when the mate is in the same slice           |
| `templateSize`                | `number \| undefined`             | template length as the file stores it, when the mate is elsewhere                   |
| `qualityScores`               | `Uint8Array \| null \| undefined` | base qualities; `null` for `*`, `undefined` when the file has none                  |
| `tags`                        | `object`                          | every auxiliary tag; `getTag(name)` is faster for one                               |
| `readFeatures`                | `ReadFeature[] \| undefined`      | the raw CRAM encoding; see [read-features.md](read-features.md)                     |
| `slice`, `index`              | `DecodedSlice`, `number`          | the decoded slice the record reads from, and its position in it                     |

`qualityScores` and `readFeatures` build a new array on every access, so read
them into a local variable instead of accessing them in a loop.

### Methods

| Method                             | Returns                       | Description                                                     |
| ---------------------------------- | ----------------------------- | --------------------------------------------------------------- |
| `getReadBases()`                   | `string \| null \| undefined` | the read sequence; `null` for a record with no bases            |
| `getCigarString()`                 | `string`                      | CIGAR, such as `50M2I48M`; `*` for an unmapped read             |
| `getMismatches(opts?)`             | `Mismatch[]`                  | each difference from the reference; see [`Mismatch`](#mismatch) |
| `getTag(name)`                     | tag value or `undefined`      | one auxiliary tag                                               |
| `qualityScoreAt(pos)`              | `number`                      | quality at a 0-based read position; `-1` when the file has none |
| `getLeadingClipLength()`           | `number`                      | bases clipped by the first CIGAR operation, or 0                |
| `getTrailingClipLength()`          | `number`                      | bases clipped by the last CIGAR operation, or 0                 |
| `getPairOrientation()`             | `string \| undefined`         | `F1R2`-style orientation; `undefined` for an unpaired read      |
| `forEachCigarOp(callback)`         |                               | the CIGAR, one operation at a time                              |
| `forEachMismatch(callback, opts?)` |                               | the differences, one at a time                                  |
| `toJSON()`                         | object                        | the record as a plain object                                    |

`getReadBases()` and the base fields of the mismatch methods need
`fetchReferenceSequence`. The CIGAR methods do not.

`getMismatches` and `forEachMismatch` take `{ start, end, origin }`, all
optional. `start` and `end` are a reference range that limits the result to the
differences touching it. Positions are reported relative to `origin`, which
defaults to 0, so `origin: record.start` gives positions relative to the read;
`start` and `end` stay reference coordinates either way.

### Without allocating

`forEachCigarOp` and `forEachMismatch` call your function once per operation or
difference instead of building an array or string, which matters when a consumer
walks many records.

```js
record.forEachCigarOp((op, length) => {
  // op is CIGAR_MATCH, CIGAR_INS, CIGAR_DEL, ... (SAM's numbering),
  // so (length << 4) | op is BAM's packed form
})

record.forEachMismatch(
  (code, refPos, length, bases, qual, refBaseCode, clipLength) => {},
  { start, end },
)
```

The storage behind tags, qualities and read features is one array per slice, and
these properties read it directly:

| Property                                                   | Contents                                             |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| `qualityColumn`, `qualityStart`                            | every quality in the slice, and this record's offset |
| `tagColumn`, `tagStart`, `tagCount`                        | every tag in the slice, and this record's slots      |
| `readFeatureArena`, `readFeatureStart`, `readFeatureCount` | every read feature in the slice, and this record's   |

[memory.md](memory.md) explains the layout, and the ADRs
[0006](adr/0006-cigar-as-a-callback-walk.md) and
[0008](adr/0008-emit-into-the-consumers-callback.md) record the measurements
behind the callbacks.

### Flag methods

Each returns a `boolean`.

| Method                        | True when                                            |
| ----------------------------- | ---------------------------------------------------- |
| `isPaired()`                  | the read is paired                                   |
| `isProperlyPaired()`          | both segments mapped as a proper pair                |
| `isSegmentUnmapped()`         | this read did not map                                |
| `isMateUnmapped()`            | the mate did not map                                 |
| `isReverseComplemented()`     | the read mapped to the reverse strand                |
| `isMateReverseComplemented()` | the mate mapped to the reverse strand                |
| `isRead1()`, `isRead2()`      | the read is the first or second segment              |
| `isSecondary()`               | the alignment is secondary                           |
| `isSupplementary()`           | the alignment is supplementary                       |
| `isFailedQc()`                | the read failed quality control                      |
| `isDuplicate()`               | the read is a PCR or optical duplicate               |
| `hasNextPosition()`           | the file records the next segment's position         |
| `isDetached()`                | CRAM: the record stores its mate information itself  |
| `hasMateDownStream()`         | CRAM: the mate is later in the same slice            |
| `isPreservingQualityScores()` | CRAM: the file kept per-base qualities for this read |
| `isUnknownBases()`            | CRAM: the file stored no bases for this read         |

## `Mismatch`

`getMismatches()` returns these, and `forEachMismatch` passes the same fields as
arguments, in this order.

| Field         | Description                                                                           |
| ------------- | ------------------------------------------------------------------------------------- |
| `code`        | char code of `X` substitution, `I` insertion, `D` deletion, `N` skip, `S` or `H` clip |
| `refPos`      | 0-based reference position                                                            |
| `length`      | reference bases covered: 1 for `X`, the length for `D` and `N`, else 0                |
| `bases`       | the substituted or inserted bases                                                     |
| `qual`        | quality of a substituted base, or `-1`                                                |
| `refBaseCode` | char code of the reference base a substitution replaces, or `0` when unknown          |
| `clipLength`  | read bases consumed by an insertion or clip, else 0                                   |

The package exports `RF_SUBST`, `RF_INSERTION` and the other `RF_*` constants to
compare against `code`.

## Other exports

The classes above cover reading a file. The package also exports the constants,
storage classes and types that the lower-level APIs use.

### Constants

| Export                                                                                                                                                                      | Description                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `CIGAR_MATCH`, `CIGAR_INS`, `CIGAR_DEL`, `CIGAR_REF_SKIP`, `CIGAR_SOFT_CLIP`, `CIGAR_HARD_CLIP`, `CIGAR_PAD`, `CIGAR_EQUAL`, `CIGAR_DIFF`                                   | the `op` values `forEachCigarOp` passes, numbered 0 to 8 as in BAM                                               |
| `CIGAR_OP_CHARS`                                                                                                                                                            | `'MIDNSHP=X'`, so `CIGAR_OP_CHARS[op]` is the op's letter                                                        |
| `RF_SUBST`, `RF_INSERTION`, `RF_DELETION`, `RF_REF_SKIP`, `RF_SOFT_CLIP`, `RF_HARD_CLIP`, `RF_PADDING`, `RF_INSERT_BASE`, `RF_BASES`, `RF_BASE_QUAL`, `RF_QUAL`, `RF_QUALS` | read-feature codes, as the char code of each CRAM code letter; see [read-features.md](read-features.md)          |
| `RF_POSITIONAL`                                                                                                                                                             | a table indexed by read-feature code: 1 where the feature's `refPos` is an alignment position, 0 for `q` and `Q` |
| `TAG_NUMBER`, `TAG_CHAR`, `TAG_STRING`, `TAG_ARRAY`                                                                                                                         | the kinds of value a `TagColumn` stores                                                                          |
| `NEXT_UNKNOWN`                                                                                                                                                              | the `nextSequenceId` of a record whose file does not locate the next segment                                     |
| `DEFAULT_MAX_CACHE_BYTES`, `DEFAULT_CACHE_IDLE_TIMEOUT_MS`                                                                                                                  | the defaults of `maxCacheBytes` and `cacheIdleTimeoutMs`                                                         |

### Classes and functions

| Export                            | Description                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| `DecodedSlice`                    | the columns of one decoded slice; see [memory.md](memory.md)                               |
| `ReadFeatureArena`                | the read-feature columns of a slice, which `readFeatureArena` returns                      |
| `TagColumn`                       | the tag columns of a slice, which `tagColumn` returns                                      |
| `arenaFromReadFeatures(features)` | builds a one-record `ReadFeatureArena` from `ReadFeature` objects, for synthesized records |
| `getSharedSliceWorkerPool()`      | the shared worker pool, created on first use; `undefined` where workers are unavailable    |
| `createSliceWorkerPool(n?, url?)` | a separate pool of `n` workers; throws where workers are unavailable                       |
| `destroySharedSliceWorkerPool()`  | terminates the shared pool's workers                                                       |

### Types

| Export                                | Description                                                           |
| ------------------------------------- | --------------------------------------------------------------------- |
| `SeqFetch`                            | the type of `fetchReferenceSequence`                                  |
| `ReferenceInfo`                       | one entry of `getReferenceInfo()`                                     |
| `BaseOpts`, `ReadOpts`, `IndexOpts`   | the options objects that take `signal` and `onProgress`               |
| `MismatchCallback`, `MismatchOptions` | the callback and options of `forEachMismatch`                         |
| `CigarCallback`                       | the callback of `forEachCigarOp`                                      |
| `TagValue`                            | a tag's value: a string, a number, an array of numbers or `undefined` |
| `RefRegion`                           | a stretch of reference bases, as `{ start, end, seq }`                |
| `Slice`                               | one `.crai` entry, as `getEntriesForRange` returns it                 |
| `CramRecordClass`                     | the type of `recordClass`                                             |
| `CramSliceWorkerPool`                 | the type of a worker pool                                             |

## Errors

Every error the library raises extends `CramError`. A network or filehandle
failure arrives as whatever the filehandle threw.

| Class                    | Raised for                                      |
| ------------------------ | ----------------------------------------------- |
| `CramMalformedError`     | malformed file data                             |
| `CramBufferOverrunError` | a read past the end of a block, from truncation |
| `CramUnimplementedError` | a part of the spec this library does not handle |
| `CramArgumentError`      | an invalid argument                             |
