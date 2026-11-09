# @gmod/cram

[![NPM version](https://img.shields.io/npm/v/@gmod/cram.svg?style=flat-square)](https://npmjs.org/package/@gmod/cram)
![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/cram-js/publish.yml?branch=main)

Read CRAM files in node or the browser. Handles CRAM 2.x and 3.x, `.crai`
indexes, and every v3 and v3.1 codec, including fqzcomp and tok3. The codecs are
the htscodecs C library that samtools uses, compiled to WebAssembly and inlined
in the bundle, so there is no `.wasm` file to serve. Golomb and Golomb-Rice,
which only v2 files use, are not implemented.

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

Coordinates are 0-based half-open, as in `@gmod/bam`; add 1 for a 1-based format
such as SAM's `POS`. Query a reference by its name in the file's header, such as
`chr1`, `1` or `CHROMOSOME_I`. A name the file lacks returns `[]`.

## Mismatches

`record.getMismatches()` lists substitutions, insertions, deletions, reference
skips and clips. Each has `code`, `refPos`, `length`, `bases`, `qual`,
`refBaseCode` and `clipLength`. `code` is a CIGAR char code (88 for `X`), and
`String.fromCharCode(code)` gives the letter without allocating a small string,
since V8 interns single-character strings. `record.forEachMismatch(callback)`
passes the same fields as arguments without building an array, and both take a
`{ start, end, origin }` window; see [docs/api.md](docs/api.md#mismatch).

### Mismatches need the reference

CRAM stores each read as its differences from the reference, so
`fetchReferenceSequence` is how substitutions get their bases. Its arguments are
`(seqId, start, end, refName, { signal })`, and it returns the bases of that
range.

- `start` and `end` are 0-based half-open, and the string returned must be
  `end - start` long. A longer string throws, and a non-empty shorter one is
  padded with `N`.
- `refName` is the name in the CRAM header and `seqId` its numeric id, so map
  the name if the FASTA spells it differently (`chr1` and `1`). A name the FASTA
  lacks gives `undefined`, which the library cannot read, so return `''` as the
  example does. `''` means the reference is unavailable.
- Without the callback, each substitution reads `N` and `getReadBases()` returns
  `undefined`. A file written with `embed_ref=1` needs no callback, and one
  written with `no_ref` shows no substitutions without it.

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

With `cramUrl`, each byte range a query reads is a separate HTTP request: one
per slice and two small ones per container.
[`@gmod/range-cache-filehandle`](https://github.com/GMOD/range-cache-filehandle)
merges nearby ranges into one request and reuses fetched bytes across queries:

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
`window.gmodCRAM`. It loads its codec worker as a second file from the same
directory, and decodes in-process without it. The [example directory](./example)
has a working page.

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
