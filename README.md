# @gmod/cram

[![NPM version](https://img.shields.io/npm/v/@gmod/cram.svg?style=flat-square)](https://npmjs.org/package/@gmod/cram)
![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/cram-js/publish.yml?branch=main)

Read CRAM files in node or the browser.

- Handles CRAM 2.x and 3.x, `.crai` indexes, and every v3 and v3.1 codec,
  including fqzcomp and tok3.
- The codecs are the htscodecs C library that samtools uses, compiled to
  WebAssembly and inlined in the bundle, so there is no `.wasm` file to serve.
- Golomb and Golomb-Rice, which only v2 files use, are not implemented.

```bash
npm install @gmod/cram
```

## Quick start

```js
import { IndexedCramFile, CraiIndex } from '@gmod/cram'
import { IndexedFasta } from '@gmod/indexedfasta'
import { RemoteFile } from 'generic-filehandle2'

const fasta = new IndexedFasta({
  fasta: new RemoteFile('https://example.com/reference.fa'),
  fai: new RemoteFile('https://example.com/reference.fa.fai'),
})

const indexedFile = new IndexedCramFile({
  cramUrl: 'https://example.com/file.cram',
  index: new CraiIndex({ url: 'https://example.com/file.cram.crai' }),
  fetchReferenceSequence: async (seqId, start, end, refName, opts) =>
    (await fasta.getSequence(refName, start, end, opts)) ?? '',
})

const records = await indexedFile.getRecordsForRange('chr1', 10000, 20000)

for (const record of records) {
  for (const { code, refPos, bases } of record.getMismatches()) {
    console.log(record.readName, String.fromCharCode(code), refPos, bases)
  }
}
```

For local files, pass `cramPath`, `CraiIndex({ path })` and
`IndexedFasta({ path })`.

- Coordinates are 0-based half-open, as in `@gmod/bam`; add 1 for a 1-based
  format such as SAM's `POS`.
- Query a reference by its name in the file's header, such as `chr1`, `1` or
  `CHROMOSOME_I`. A name the file lacks returns `[]`.

## Mismatches

`record.getMismatches()` lists substitutions, insertions, deletions, reference
skips and clips. `forEachMismatch` passes the same fields to a callback instead
of building an array. `code` is a CIGAR char code, so
`String.fromCharCode(code)` gives its letter.

```js
import { RF_SUBST } from '@gmod/cram'

record.forEachMismatch(
  (code, refPos, length, bases, qual, refBaseCode, clipLength) => {
    if (code === RF_SUBST) {
      console.log(refPos, bases)
    }
  },
  { start: 10000, end: 20000 }, // optional window
)
```

[docs/api.md](docs/api.md#mismatch) has the fields and the window options.

### Mismatches need the reference

`fetchReferenceSequence` supplies the bases of substitutions, as in the quick
start. It receives `(seqId, start, end, refName, { signal })`.

- Return the `end - start` bases from `start` (0-based half-open). A longer
  string throws, and a shorter one is padded with `N`.
- `refName` is the name in the CRAM header, so map it if the FASTA spells it
  differently (`chr1` and `1`). Return `''` for a reference you lack.
- Without the callback, each substitution reads `N`. A file written with
  `embed_ref=1` needs no callback.

[docs/api.md](docs/api.md#reference-sequence) has the details.

## Records

```js
record.getReadBases() // 'ACGT…', the read sequence
record.getCigarString() // '50M2I48M'
record.getTag('NM') // one auxiliary tag
record.qualityScoreAt(0) // one base quality
record.isReverseComplemented() // the usual SAM flags
```

[docs/api.md](docs/api.md#cramrecord) lists every property and method.

## Header, reference names and cancellation

```js
await indexedFile.cram.getReferenceInfo() // [{ name, length, md5 }, ...]
await indexedFile.cram.getSamHeader() // parsed SAM header
await indexedFile.hasDataForReferenceSequence('chrY') // false if the file has no chrY

const controller = new AbortController()
await indexedFile.getRecordsForRange('chr1', 0, 1_000_000, {
  signal: controller.signal,
})
```

## Performance

### Range caching

- With `cramUrl`, each byte range a query reads is a separate HTTP request: one
  per slice and two small ones per container.
- [`@gmod/range-cache-filehandle`](https://github.com/GMOD/range-cache-filehandle)
  merges nearby ranges into one request and reuses fetched bytes across queries.

```js
import { RemoteFileWithRangeCache } from '@gmod/range-cache-filehandle'

const indexedFile = new IndexedCramFile({
  cramFilehandle: new RemoteFileWithRangeCache(url),
  index: new CraiIndex({
    filehandle: new RemoteFileWithRangeCache(`${url}.crai`),
  }),
})
```

### Worker pool

In a browser, slices decode on a worker pool by default. Pass
`useSliceWorkerPool: false` to turn it off, or `numSliceWorkers` to set its
size. See [docs/workers.md](docs/workers.md).

## Script tag

The package ships a standalone browser build that puts the same exports on
`window.gmodCRAM`.

- It loads its codec worker as a second file from the same directory, and
  decodes in-process without it.
- The [example directory](./example) has a working page.

```html
<script src="https://unpkg.com/@gmod/cram/dist/cram-bundle.js"></script>
```

## Docs

- [docs/api.md](docs/api.md): every option, property and method, including
  walking a record's raw read features
- [MIGRATION.md](MIGRATION.md): breaking changes, newest first
- [docs/dataflow.md](docs/dataflow.md): a query from index to records, with
  links to the design docs and ADRs

## Academic use

Written with [NHGRI](http://genome.gov) funding as part of
[JBrowse](http://jbrowse.org). If you use this in a publication, please cite the
most recent JBrowse paper at [jbrowse.org](http://jbrowse.org).

## License

MIT
