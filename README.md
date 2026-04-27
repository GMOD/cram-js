# @gmod/cram

[![NPM version](https://img.shields.io/npm/v/@gmod/cram.svg?style=flat-square)](https://npmjs.org/package/@gmod/cram)
[![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/cram-js/push.yml?branch=main)](https://github.com/GMOD/cram-js/actions?query=branch%3Amain+workflow%3APush+)

Read CRAM files with pure JS, works in node or the browser. Supports CRAM 2.x
and 3.x, `.crai` indexes, and bzip2/lzma codecs.

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

  for (const feature of record.readFeatures ?? []) {
    if (feature.code === 'X') {
      console.log(`${feature.ref}->${feature.sub} at ref pos ${feature.refPos}`)
    }
  }
}
```

See the [example directory](./example) for browser usage with `<script>` tag and
the bundled `cram-bundle.js`.

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
- `qualityScores` — `Int8Array` of per-base quality scores
- `readFeatures` — array of read features (see below)
- `tags` — auxiliary tags object

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

- `getReadBases()` → `string` — returns the read sequence string. Requires `seqFetch` to be configured and is populated automatically by `getRecordsForRange`.

### ReadFeatures

Each entry in `record.readFeatures`:

- `code` — feature type (one of `bqBXIDiQNSPH`, see CRAM spec §8)
- `pos` — read position (1-based)
- `refPos` — reference position (1-based)
- `ref` / `sub` — reference and substituted base (code `X` only)

### Parsing Read Features

Common use case: extracting SNPs, insertions, and deletions from a record:

```js
const records = await indexedFile.getRecordsForRange(seqId, start, end)

for (const record of records) {
  const snps = []
  const insertions = []
  const deletions = []

  if (record.readFeatures) {
    for (const feature of record.readFeatures) {
      if (feature.code === 'X') {
        // SNP: single base substitution
        snps.push({
          position: feature.refPos,
          ref: feature.ref,
          alt: feature.sub,
        })
      } else if (feature.code === 'I') {
        // Insertion: full inserted sequence
        insertions.push({
          position: feature.refPos,
          seq: feature.data,
        })
      } else if (feature.code === 'i') {
        // Insertion: single base padding (no sequence stored)
        insertions.push({
          position: feature.refPos,
          padded: true,
        })
      } else if (feature.code === 'D') {
        // Deletion: bases deleted from reference
        deletions.push({
          position: feature.refPos,
          length: feature.data,
        })
      }
    }
  }
}
```

For more complex CIGAR string generation from read features, see the JBrowse
[readFeaturesToNumericCIGAR](https://github.com/GMOD/jbrowse-components/blob/main/plugins/alignments/src/CramAdapter/readFeaturesToNumericCIGAR.ts)
implementation.

### Error classes

- `CramUnimplementedError` — unimplemented spec feature
- `CramMalformedError` — malformed file data
- `CramBufferOverrunError` — read past end of data

## Publishing

Push a git tag to trigger a release via GitHub Actions and
[npm trusted publishing](https://docs.npmjs.com/generating-provenance-statements).

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
npm version patch  # or minor/major
```
