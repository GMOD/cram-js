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

## Usage

```js
import { IndexedCramFile, CraiIndex } from '@gmod/cram'
import { IndexedFasta } from '@gmod/indexedfasta'

const fasta = new IndexedFasta({
  path: '/path/to/reference.fa',
  faiPath: '/path/to/reference.fa.fai',
})

const idToName = []
const nameToId = {}

const indexedFile = new IndexedCramFile({
  cramPath: '/path/to/file.cram',
  // alternatives: cramUrl, cramFilehandle (see generic-filehandle2)
  index: new CraiIndex({
    path: '/path/to/file.cram.crai',
    // alternatives: url, filehandle
  }),
  seqFetch: async (seqId, start, end) => {
    // seqId is numeric; coordinates are 1-based but IndexedFasta is 0-based
    return fasta.getSequence(idToName[seqId], start - 1, end)
  },
  checkSequenceMD5: false,
})

// Build numeric refId <-> name mappings from the SAM header
const samHeader = await indexedFile.cram.getSamHeader()
samHeader
  .filter(l => l.tag === 'SQ')
  .forEach((sqLine, refId) => {
    sqLine.data.forEach(item => {
      if (item.tag === 'SN') {
        nameToId[item.value] = refId
        idToName[refId] = item.value
      }
    })
  })

// Fetch records for a range (1-based, closed coordinates)
const records = await indexedFile.getRecordsForRange(
  nameToId['chr1'],
  10000,
  20000,
)

for (const record of records) {
  console.log(record.readName, record.alignmentStart, record.mappingQuality)
  console.log(record.getCigarString()) // e.g. "50M2I48M"

  // Where this read differs from the reference
  for (const m of record.getMismatches()) {
    console.log(
      String.fromCharCode(m.code), // 'X', 'I', 'D', 'N', 'S' or 'H'
      m.refPos, // 1-based reference position
      m.bases, // substituted or inserted bases
      m.length, // reference bases covered (deletions, skips)
      m.clipLength, // read bases consumed (insertions, clips)
    )
  }
}
```

See the [example directory](./example) for browser usage with `<script>` tag and
the bundled `cram-bundle.js`.

### Reading differences from the reference

`getMismatches()` is the intended way to ask what a read says. Use
`forEachMismatch(callback)` instead when you care about allocation — it reports
the same differences without building an object for each one:

```js
record.forEachMismatch(
  (code, refPos, length, bases, qual, refBaseCode, clipLength) => {
    // ...
  },
)

// or restrict to a region, skipping differences outside it
record.forEachMismatch(cb, { start: 10000, end: 10100 })
```

Both need `seqFetch` configured to resolve the actual bases of a substitution.
Without it, a substitution still reports at the right position but with `bases`
of `'N'` and a `refBaseCode` of `0`.

Read features — the raw CRAM encoding these are derived from — are also
available as `record.readFeatures`, but interpreting them correctly takes a fair
amount of the format. `i` and `I` are both insertions and store their payload
differently; a run of `i` features is _one_ insertion; `b` is a stretch of
verbatim bases that align as matches; `q` and `Q` carry only quality, and their
`refPos` is **not** an alignment position, so a walk that tracks position across
features must skip them (`RF_POSITIONAL` marks which codes to skip); and an `X`
feature's `data` is an index into the container's substitution matrix, not a
base. Each of those has caused a bug in a downstream consumer. Prefer
`getMismatches()`, `getCigarString()` and `getReadBases()`, which handle it.

## API

### `IndexedCramFile`

```js
new IndexedCramFile({
  cramPath, // local path
  cramUrl, // remote URL
  cramFilehandle, // generic-filehandle2 compatible handle
  index, // CraiIndex instance (or any object with getEntriesForRange)
  seqFetch, // async (seqId, start, end) => string
  checkSequenceMD5, // default true; set false to avoid large reference fetches
  cacheSize, // max cached records, default 20000
})
```

- `getRecordsForRange(seqId, start, end, opts?)` → `Promise<CramRecord[]>` —
  1-based closed coords. `opts`: `{ viewAsPairs, pairAcrossChr, maxInsertSize }`
- `hasDataForReferenceSequence(seqId)` → `Promise<boolean>`

### `CraiIndex`

Takes `{ path, url, filehandle }` — one of the three is required.

### `CramRecord`

**Properties:**

- `readName` — read name
- `sequenceId` — numeric reference ID
- `alignmentStart` — 1-based start position
- `qualityScores` — `Uint8Array` of per-base quality scores
- `tags` — auxiliary tags object
- `readFeatures` — the raw read features as an array (see below); rebuilt from
  the columns on each access, so read it into a local rather than in a loop
  condition, and prefer `getMismatches()` for interpreting them
- `readFeatureArena`, `readFeatureStart`, `readFeatureCount` — the columnar
  storage the features are decoded into, shared across every record in a slice.
  Reading these columns instead of `readFeatures` is what makes a bulk consumer
  fast: 3.7x on a long-read slice, and a fraction of the memory

**Flag methods** (all return `boolean`):

- `isPaired()`
- `isProperlyPaired()`
- `isSegmentUnmapped()`
- `isMateUnmapped()`
- `isReverseComplemented()`
- `isMateReverseComplemented()`
- `isRead1()`
- `isRead2()`
- `isSecondary()`
- `isFailedQc()`
- `isDuplicate()`
- `isSupplementary()`

**Methods:**

- `getReadBases()` → `string | null | undefined` — returns the read sequence
  string. Requires `seqFetch` to be configured and is populated automatically by
  `getRecordsForRange`.
- `getCigarString()` → `string` — returns the CIGAR string describing the read's
  alignment (e.g. `"50M2I48M"`), reconstructed from the read features.
  Substitutions and mismatches are reported as `M` per the plain CIGAR
  convention; unmapped reads, and mapped reads with no operations, return `"*"`.
  Does not require `seqFetch`.
- `getMismatches(opts?)` → `Mismatch[]` — every difference from the reference.
  `opts` is an optional `{ start, end }` 1-based closed reference range.
- `forEachMismatch(callback, opts?)` — the same differences, reported to
  `callback(code, refPos, length, bases, qual, refBaseCode, clipLength)` without
  allocating per difference.

### Mismatch

What `getMismatches()` returns, and the argument order `forEachMismatch` passes:

- `code` — char code of `X` (substitution), `I` (insertion), `D` (deletion), `N`
  (reference skip), `S` (soft clip) or `H` (hard clip). Compare against the
  exported `RF_SUBST`, `RF_INSERTION`, … constants. Insertions arrive as `I`
  whether the file encoded them as `I` or as a run of `i`.
- `refPos` — 1-based reference position
- `length` — reference bases covered: 1 for a substitution, the deleted or
  skipped length for `D`/`N`, and 0 for insertions and clips
- `bases` — the substituted base, or the inserted bases; empty for
  `D`/`N`/`S`/`H`
- `qual` — quality of a substituted base, `-1` when the file does not store it
- `refBaseCode` — char code of the reference base a substitution replaces, `0`
  when unknown
- `clipLength` — read bases consumed: the inserted or clipped length, else 0

### ReadFeatures

Each entry in `record.readFeatures`, the raw CRAM encoding (see CRAM spec
§10.2):

- `code` — feature type, one of `bqBXIDiQNSPH`
- `pos` — read position (1-based)
- `refPos` — reference position (1-based) — **except for `q` and `Q`**, whose
  `refPos` is derived from a read position the reference never reaches, so it
  can point backwards into an insertion. `RF_POSITIONAL[code]` is 0 for exactly
  those two.
- `data` — the payload, which differs per code: the inserted, clipped or
  verbatim bases as a string for `I`/`S`/`b`/`i` (including `i`, which is a
  single-base insertion and does store its base); the deleted, skipped, clipped
  or padded length as a number for `D`/`N`/`H`/`P`; the quality score for `Q`
  and an array of them for `q`; `[base, quality]` for `B`; and for `X`, an index
  into the container's substitution matrix — not a base
- `ref` / `sub` — reference and substituted base (code `X` only), present only
  once a reference has been applied, i.e. when `seqFetch` is configured

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
