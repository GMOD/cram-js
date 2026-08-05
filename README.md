# @gmod/cram

[![NPM version](https://img.shields.io/npm/v/@gmod/cram.svg?style=flat-square)](https://npmjs.org/package/@gmod/cram)
![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/cram-js/publish.yml?branch=main)

Read CRAM files in node or the browser. Supports CRAM 2.x and 3.x, `.crai`
indexes, and all CRAM v3 block codecs (gzip, bzip2, lzma, rANS, arithmetic,
fqzcomp, tok3). See [docs/CODEC_SUPPORT.md](docs/CODEC_SUPPORT.md).

Block decoding runs in WebAssembly, built from the same htscodecs C that
samtools uses and inlined in the bundle, so you get native decode speed and
every v3.1 codec without another file to serve or anything to configure. It
weighs 55 KB gzipped, takes about 5 ms to start up once, and keeps a 16 MB wasm
heap. More in [docs/WASM.md](docs/WASM.md).

## Install

```bash
npm install @gmod/cram
```

## Coordinates

Every coordinate this library gives you or takes from you is **0-based
half-open**, the same as `@gmod/bam`. When you convert back to a 1-based text
format, like SAM's `POS` or a locus you're showing a user, add 1.

This changed in v10. Coordinates were 1-based closed through v9, and `seqFetch`
is now `fetchReferenceSequence`. If you're upgrading, see
[MIGRATION.md](MIGRATION.md).

## Usage

```js
import { IndexedCramFile, CraiIndex } from '@gmod/cram'
import { IndexedFasta } from '@gmod/indexedfasta'

const fasta = new IndexedFasta({
  path: '/path/to/reference.fa',
  faiPath: '/path/to/reference.fa.fai',
})

const indexedFile = new IndexedCramFile({
  cramPath: '/path/to/file.cram',
  // alternatives: cramUrl, cramFilehandle (see generic-filehandle2)
  index: new CraiIndex({
    path: '/path/to/file.cram.crai',
    // alternatives: url, filehandle
  }),
  // refName is the @SQ SN for seqId; coordinates are 0-based half-open, as
  // IndexedFasta's are
  fetchReferenceSequence: (seqId, start, end, refName) =>
    fasta.getSequence(refName, start, end),
  checkSequenceMD5: false,
})

const refId = await indexedFile.cram.getReferenceId('chr1')
const records = await indexedFile.getRecordsForRange(refId, 10000, 20000)

for (const record of records) {
  console.log(record.readName, record.start, record.mappingQuality)
  console.log(record.getCigarString()) // e.g. "50M2I48M"

  // Where this read differs from the reference
  for (const m of record.getMismatches()) {
    console.log(
      String.fromCharCode(m.code), // 'X', 'I', 'D', 'N', 'S' or 'H'
      m.refPos, // 0-based reference position
      m.length, // reference bases covered (deletions, skips)
      m.bases, // substituted or inserted bases
      m.clipLength, // read bases consumed (insertions, clips)
    )
  }
}
```

See the [example directory](./example) for browser usage with `<script>` tag and
the bundled `cram-bundle.js`.

### Reference sequences

CRAM identifies a reference by **number**, not by name. That number — `seqId`,
or `refId` — is just the position of the reference's `@SQ` line in the SAM
header:

```
@SQ  SN:chr1  LN:248956422    ->  0
@SQ  SN:chr2  LN:242193529    ->  1
@SQ  SN:chrX  LN:156040895    ->  2
```

`getRecordsForRange`, `record.sequenceId` and the `.crai` index all speak in
those numbers. The order is whatever a given file says, so don't hardcode one —
ask the file:

```js
const { cram } = indexedFile

await cram.getReferenceId('chr1') // 0, throws if the header has no such SN
await cram.getReferenceName(0) // 'chr1', undefined if there is no such @SQ
await cram.getReferenceInfo() // [{ name, length, md5 }, ...] in @SQ order
```

`fetchReferenceSequence` is handed both the number and the name, so if your
sequence source is keyed by name, like `IndexedFasta` is, you can use the name
directly and skip the lookup.

The only id that isn't an `@SQ` position is `-1`, which means the read is
[unplaced](#indexedcramfile).

### Reading differences from the reference

`getMismatches()` is the intended way to see how a read differs from the
reference. If you're processing enough records that the per-difference objects
start to matter, `forEachMismatch(callback)` reports exactly the same
differences without allocating any:

```js
record.forEachMismatch(
  (code, refPos, length, bases, qual, refBaseCode, clipLength) => {
    // ...
  },
)

// or restrict to a region, skipping differences outside it
record.forEachMismatch(cb, { start: 10000, end: 10100 })
```

Both need `fetchReferenceSequence` configured before they can tell you the
actual bases involved in a substitution. Without it you still get the
substitution, at the right position, but its `bases` come back as `'N'` and its
`refBaseCode` as `0`.

If differences are all you're after, that's the whole API. Between them,
`getMismatches()`, `getCigarString()` and `getReadBases()` answer the three
questions people usually have about a read, and none of them ask you to know
anything about how CRAM encodes it.

Underneath, a record stores its alignment as a list of _read features_, which
you can get at as `record.readFeatures`. It's a sharper tool than it looks, and
it isn't needed for mismatches, so it lives on its own page:
[docs/READ_FEATURES.md](docs/READ_FEATURES.md).

## API

### `IndexedCramFile`

```js
new IndexedCramFile({
  cramPath, // local path
  cramUrl, // remote URL
  cramFilehandle, // generic-filehandle2 compatible handle
  index, // CraiIndex instance (or any object with getEntriesForRange)
  fetchReferenceSequence, // async (seqId, start, end, refName, opts) => string
  checkSequenceMD5, // default false; set true to verify each slice's reference MD5
  cacheSize, // max cached records, default 20000
})
```

Slices are cached whole, so `cacheSize` bounds the cache by record count rather
than by slices — see [docs/MEMORY.md](docs/MEMORY.md) for why, and for what a
query in flight is allowed to exceed it by.

- `getRecordsForRange(seqId, start, end, opts?)` → `Promise<CramRecord[]>` —
  0-based half-open coords. `opts`:
  `{ viewAsPairs, pairAcrossChr, maxInsertSize, decodeTags, onProgress, signal }`
- `hasDataForReferenceSequence(seqId, opts?)` → `Promise<boolean>`
- `cram` — the underlying `CramFile`

### Cancelling a query

Pass an `AbortSignal` as `opts.signal` and the query rejects, stops decoding,
and — on a filehandle that honours the signal, which `RemoteFile` does and
`LocalFile` does not — abandons the range request it has in flight:

```js
const controller = new AbortController()
const records = indexedFile.getRecordsForRange(0, 1000, 2000, {
  signal: controller.signal,
})
controller.abort() // `records` rejects with an AbortError
```

This is worth more than "index reads are short" suggests. A byte-range-caching
filehandle coalesces adjacent reads into one request, so a small viewport over
deep data becomes a single multi-megabyte fetch — exactly the thing you want to
drop when the user pans away.

**Aborting your query never fails anyone else's.** Two things in a `CramFile`
are shared between concurrent queries: the parsed `.crai`, and each decoded
slice in the record cache. A slice's decode is reference-counted — it is
cancelled only once _every_ query waiting on it has aborted, so cancelling yours
costs a concurrent query nothing, not even a re-read. The file definition and
SAM header are read once for the life of the object and are deliberately not
cancellable at all.

The corollary: a query with **no** signal can never give up, so it pins any
slice it is waiting on. If one caller omits the signal, that slice's decode
stops being cancellable for everyone sharing it — so thread the signal through
consistently rather than on the queries you happen to care about.

If `fetchReferenceSequence` is backed by something remote, it is handed the
signal as a fifth argument (`opts.signal`) so it can cancel too. Ignoring it is
fine; a four-argument callback keeps working unchanged.

Unplaced reads have no position at all and sort to the end of the file. Both
their `sequenceId` and their `start` are `-1`, so you ask for them like this:

```js
await indexedFile.getRecordsForRange(-1, -1, end) // a start of 0 finds nothing
```

Reads that are unmapped but _placed_ at their mate's position are a different
case. They carry the mate's `sequenceId` and `start`, so an ordinary range query
finds them.

### `CramFile`

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

### `CraiIndex`

Takes `{ path, url, filehandle }` — one of the three is required.

### `CramRecord`

**Properties:**

- `readName` — read name
- `sequenceId` — numeric reference ID
- `start` — 0-based start position; `-1` for an unplaced read
- `lengthOnRef` — reference bases the alignment covers, `undefined` for an
  unmapped read
- `qualityScores` — `Uint8Array` of per-base quality scores, `null` for a `*`
  record, `undefined` when the file did not preserve them. Built on every access
  as a view over `qualityColumn` below, so pull it into a local rather than
  indexing it in a loop.
- `qualityScoreAt(pos)` — the score at a 0-based read position, or `-1` when the
  file has none. Reads straight out of the column, allocating nothing.
- `qualityColumn`, `qualityStart` — every quality score in the record's slice
  laid end to end, and this record's offset into it. Hoist these out of a
  per-base loop and index `qualityColumn[qualityStart + i]`.
- `tags` — auxiliary tags object
- `readFeatures` — the raw read features, as an array. Prefer `getMismatches()`;
  see [docs/READ_FEATURES.md](docs/READ_FEATURES.md) if you really do need this
  level. The array is rebuilt on every access, so pull it into a local rather
  than reading it in a loop condition.
- `readFeatureArena`, `readFeatureStart`, `readFeatureCount` — the columnar
  storage the features decode into, shared across every record in a slice.
  Reading these columns instead of `readFeatures` is what makes a bulk consumer
  fast: 3.7x on a long-read slice, at a fraction of the memory.

Read features and quality scores are both stored as one shared typed array per
slice rather than per record, because a per-record `Uint8Array` costs ~104 bytes
in V8 — more than the quality scores of a short read.
[docs/MEMORY.md](docs/MEMORY.md) covers what a decoded slice retains, how to
read these columns without allocating, and how the slice cache is bounded.

**Flag methods:** the usual SAM flags (spec §1.4), all returning `boolean`.

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

**Methods:**

- `getReadBases()` → `string | null | undefined` — the read sequence. Needs
  `fetchReferenceSequence`; `getRecordsForRange` applies the reference for you.
- `getCigarString()` → `string` — the read's alignment (e.g. `"50M2I48M"`),
  reconstructed from the read features. Substitutions and mismatches are
  reported as `M`, per the plain CIGAR convention. Unmapped reads, and mapped
  reads with no operations, return `"*"`. Does not require
  `fetchReferenceSequence`.
- `forEachCigarOp(callback)` — the same alignment reported to
  `callback(op, length)` one operation at a time, without building a CIGAR of
  any kind. `op` is one of the exported `CIGAR_MATCH`, `CIGAR_INS`, `CIGAR_DEL`,
  `CIGAR_REF_SKIP`, `CIGAR_SOFT_CLIP`, `CIGAR_HARD_CLIP`, `CIGAR_PAD` — the
  numbering the SAM spec gives them, so `(length << 4) | op` is BAM's packed
  form. Adjacent runs of the same op are merged and zero-length ops dropped.
  Reach for this whenever the answer is a measurement rather than text — a
  reference span, an op histogram, or the packed `(length << 4) | op` array BAM
  stores natively:

  ```js
  const packed = []
  record.forEachCigarOp((op, length) => {
    packed.push((length << 4) | op)
  })
  ```

  CRAM stores no CIGAR — unlike BAM, where the packed array is on disk and can
  be read as a zero-copy view, here it is always reconstructed from the read
  features. So this library hands out the walk rather than an array type it
  would have picked for you.

- `getLeadingClipLength()` → `number` and `getTrailingClipLength()` → `number` —
  how many bases the **first** and **last** CIGAR operations clip, or 0 when
  they are not clips. Both read only the features at that end of the record, so
  they are O(1) where walking the CIGAR to look at one of its operations is
  O(operations), and a long read has thousands. Each reports that one operation
  and no more, so a `5H4S…10M…4S5H` read clips 5 at each end, not 9.

  Between them these answer "how much of this read is clipped, as sequenced":
  the leading clip for a forward-strand read and the trailing one for a
  reverse-strand read, since a reverse-strand read is stored
  reverse-complemented.

- `getMismatches(opts?)` → `Mismatch[]` — every difference from the reference.
  `opts` is an optional `{ start, end }` 0-based half-open reference range.
- `forEachMismatch(callback, opts?)` — the same differences, reported to
  `callback(code, refPos, length, bases, qual, refBaseCode, clipLength)` without
  allocating per difference.

### Mismatch

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

### ReadFeatures

The raw CRAM encoding behind `record.readFeatures`, documented in
[docs/READ_FEATURES.md](docs/READ_FEATURES.md). You don't need it for
mismatches.

### Error classes

- `CramUnimplementedError` — unimplemented spec feature
- `CramMalformedError` — malformed file data
- `CramBufferOverrunError` — read past end of data

## Design notes

[docs/adr/](docs/adr/) records the decisions that shape how the decoder is put
together — what was decided, the measurement that settled it, and what it costs.
[TODO.md](TODO.md) is the other half: work investigated and measured but not
done, including what was deliberately rejected.

## Academic Use

Written with [NHGRI](http://genome.gov) funding as part of
[JBrowse](http://jbrowse.org). If you use this in a publication, please cite the
most recent JBrowse paper at [jbrowse.org](http://jbrowse.org).

## License

MIT © [Robert Buels](https://github.com/rbuels)

## Publishing

[Trusted publishing](https://docs.npmjs.com/about-trusted-publishing) via GitHub
Actions.

```bash
pnpm version patch  # or minor/major
```
