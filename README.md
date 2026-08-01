# @gmod/cram

[![NPM version](https://img.shields.io/npm/v/@gmod/cram.svg?style=flat-square)](https://npmjs.org/package/@gmod/cram)
![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/cram-js/publish.yml?branch=main)

Read CRAM files with pure JS, works in node or the browser. Supports CRAM 2.x
and 3.x, `.crai` indexes, and all CRAM v3 block codecs (gzip, bzip2, lzma, rANS,
arithmetic, fqzcomp, tok3). See [docs/CODEC_SUPPORT.md](docs/CODEC_SUPPORT.md).

## Install

```bash
npm install @gmod/cram
```

## Coordinates

Every coordinate this library hands out or takes in is **0-based half-open**,
matching `@gmod/bam`. Converting back out to a 1-based text format (SAM `POS`, a
locus string for a user) means adding 1.

This changed in v10 — coordinates were 1-based closed through v9, and `seqFetch`
was renamed to `fetchReferenceSequence`. See [MIGRATION.md](MIGRATION.md).

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

`fetchReferenceSequence` receives both the number and the name, so a name-keyed
sequence source like `IndexedFasta` needs no lookup of its own.

`-1` is the one id that is not an `@SQ` position — it means
[unplaced](#indexedcramfile).

### Reading differences from the reference

`getMismatches()` is the intended way to see how a read differs from the
reference. Use `forEachMismatch(callback)` instead when you care about
allocation — it reports the same differences without building an object for each
one:

```js
record.forEachMismatch(
  (code, refPos, length, bases, qual, refBaseCode, clipLength) => {
    // ...
  },
)

// or restrict to a region, skipping differences outside it
record.forEachMismatch(cb, { start: 10000, end: 10100 })
```

Both need `fetchReferenceSequence` configured to resolve the actual bases of a
substitution. Without it, a substitution still reports at the right position but
with `bases` of `'N'` and a `refBaseCode` of `0`.

If mismatches are all you want, you are done — `record.readFeatures` is not
involved. `getMismatches()` reports every read feature that is a difference from
the reference: substitutions, insertions under either encoding, deletions,
skips, and soft and hard clips.

`readFeatures` exposes the raw CRAM encoding underneath, and is only worth
reaching for to get at the features that are _not_ differences: quality scores
(`q`, `Q`), explicit base-plus-quality (`B`), padding (`P`) and verbatim base
stretches (`b`, which align as matches). For everything else prefer
`getMismatches()`, `getCigarString()` and `getReadBases()` — every trap below
has caused a bug in a consumer that walked the features itself.

- `i` and `I` are both insertions and store their payload differently
- a run of `i` features is _one_ insertion
- `b` is a stretch of verbatim bases that align as matches
- `q` and `Q` carry only quality, and their `refPos` is **not** an alignment
  position, so a positional walk must skip them (`RF_POSITIONAL` marks which)
- an `X` feature's `data` indexes the container's substitution matrix, not a
  base

## API

### `IndexedCramFile`

```js
new IndexedCramFile({
  cramPath, // local path
  cramUrl, // remote URL
  cramFilehandle, // generic-filehandle2 compatible handle
  index, // CraiIndex instance (or any object with getEntriesForRange)
  fetchReferenceSequence, // async (seqId, start, end, refName) => string
  checkSequenceMD5, // default true; set false to avoid large reference fetches
  cacheSize, // max cached records, default 20000
})
```

- `getRecordsForRange(seqId, start, end, opts?)` → `Promise<CramRecord[]>` —
  0-based half-open coords. `opts`:
  `{ viewAsPairs, pairAcrossChr, maxInsertSize, decodeTags, onProgress }`
- `hasDataForReferenceSequence(seqId)` → `Promise<boolean>`
- `cram` — the underlying `CramFile`

Unplaced reads — no position at all, sorted to the end of the file — have
`sequenceId` and `start` of `-1`:

```js
await indexedFile.getRecordsForRange(-1, -1, end) // a start of 0 finds nothing
```

Reads that are unmapped but _placed_ at their mate's position carry the mate's
`sequenceId` and `start`, and come back from an ordinary range query.

### `CramFile`

Also usable standalone via `new CramFile({ path, url, filehandle })`, without an
index, for reading the header or walking containers.

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
- `qualityScores` — `Uint8Array` of per-base quality scores
- `tags` — auxiliary tags object
- `readFeatures` — the raw read features as an array (see
  [ReadFeatures](#readfeatures)). Prefer `getMismatches()` for interpreting
  them. The array is rebuilt from the columnar storage on every access, so
  assign it to a local instead of reading it in a loop condition.
- `readFeatureArena`, `readFeatureStart`, `readFeatureCount` — the columnar
  storage the features are decoded into, shared across every record in a slice.
  Reading these columns instead of `readFeatures` is what makes a bulk consumer
  fast: 3.7x on a long-read slice, and a fraction of the memory.

**Flag methods**, all returning `boolean`: `isPaired()`, `isProperlyPaired()`,
`isSegmentUnmapped()`, `isMateUnmapped()`, `isReverseComplemented()`,
`isMateReverseComplemented()`, `isRead1()`, `isRead2()`, `isSecondary()`,
`isFailedQc()`, `isDuplicate()`, `isSupplementary()`.

**Methods:**

- `getReadBases()` → `string | null | undefined` — the read sequence. Needs
  `fetchReferenceSequence`; `getRecordsForRange` applies the reference for you.
- `getCigarString()` → `string` — the read's alignment (e.g. `"50M2I48M"`),
  reconstructed from the read features. Substitutions and mismatches are
  reported as `M`, per the plain CIGAR convention. Unmapped reads, and mapped
  reads with no operations, return `"*"`. Does not require
  `fetchReferenceSequence`.
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

Each entry in `record.readFeatures`, the raw CRAM encoding (see CRAM spec
§10.2). Not needed for mismatches —
[`getMismatches()`](#reading-differences-from-the-reference) already reports
every feature that is a difference from the reference.

- `code` — feature type, one of `bqBXIDiQNSPH`
- `pos` — read position (0-based)
- `refPos` — reference position (0-based), **except for `q` and `Q`**. Those two
  derive `refPos` from a read position the reference never reaches, so it can
  point backwards into an insertion. `RF_POSITIONAL[code]` is 0 for exactly
  those two.
- `data` — the payload, which differs per code (see table below)
- `ref` / `sub` — reference and substituted base (code `X` only), present only
  once a reference has been applied, i.e. when `fetchReferenceSequence` is
  configured

`data` by feature code:

| Code(s)            | `data`                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `I`, `S`, `b`, `i` | the inserted, clipped or verbatim bases, as a string — including `i`, which is a single-base insertion and does store its base |
| `D`, `N`, `H`, `P` | the deleted, skipped, clipped or padded length, as a number                                                                    |
| `Q`                | the quality score                                                                                                              |
| `q`                | an array of quality scores                                                                                                     |
| `B`                | `[base, quality]`                                                                                                              |
| `X`                | an index into the container's substitution matrix — **not** a base                                                             |

### Error classes

- `CramUnimplementedError` — unimplemented spec feature
- `CramMalformedError` — malformed file data
- `CramBufferOverrunError` — read past end of data

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
