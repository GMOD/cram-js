# @gmod/cram

[![NPM version](https://img.shields.io/npm/v/@gmod/cram.svg?style=flat-square)](https://npmjs.org/package/@gmod/cram)
![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/cram-js/publish.yml?branch=main)

Read CRAM files in node or the browser. Handles CRAM 2.x and 3.x, `.crai`
indexes, and every v3 and v3.1 codec, including fqzcomp and tok3. The codecs are
the htscodecs C library that samtools uses, compiled to WebAssembly and inlined
in the bundle, so there is no `.wasm` file to serve.

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
  fetchReferenceSequence: (seqId, start, end, refName) =>
    fasta.getSequence(refName, start, end),
})

const records = await indexedFile.getRecordsForRange('chr1', 10000, 20000)

for (const record of records) {
  console.log(record.readName, record.start, record.getCigarString())
}
```

URLs work in node and the browser. For local files, pass `cramPath` and
`CraiIndex({ path })`, and `IndexedFasta({ path })`.

`fetchReferenceSequence` supplies the reference bases that CRAM stores reads
against. Without it, records still have positions and CIGAR strings, but not
read bases. [docs/api.md](docs/api.md#reference-sequence) has the details.

### Range caching

A query makes one read per slice and two small ones per container, and `cramUrl`
sends each read as a separate range request.
[`@gmod/range-cache-filehandle`](https://github.com/GMOD/range-cache-filehandle)
serves the reads from 256 KiB chunks, so neighboring reads share a request:

```js
import { RemoteFileWithRangeCache } from '@gmod/range-cache-filehandle'

const indexedFile = new IndexedCramFile({
  cramFilehandle: new RemoteFileWithRangeCache(url),
  index: new CraiIndex({
    filehandle: new RemoteFileWithRangeCache(`${url}.crai`),
  }),
})
```

## Reference names

Query a reference by the name the file's header gives it, such as `chr1`, `1` or
`CHROMOSOME_I`. A query for a name the file lacks returns no records, so the
same query can run across files that cover different references:

```js
await indexedFile.getRecordsForRange('chrY', 0, 50000) // [] if the file has no chrY
await indexedFile.hasDataForReferenceSequence('chrY') // false, likewise
await indexedFile.cram.getReferenceInfo() // [{ name, length, md5 }, ...]
```

## Coordinates

Coordinates are 0-based half-open, as in `@gmod/bam`. Add 1 to convert to a
1-based format such as SAM's `POS`.

## Records

```js
record.getReadBases() // 'ACGT…', the read sequence
record.getCigarString() // '50M2I48M'
record.getMismatches() // every difference from the reference
record.getTag('NM') // one auxiliary tag
record.qualityScoreAt(0) // one base quality
record.isReverseComplemented() // the usual SAM flags
```

[docs/api.md](docs/api.md#cramrecord) lists every property and method.

## Script tag

The package ships a standalone browser build that puts the same exports on
`window.gmodCRAM`. The [example directory](./example) has a working page.

```html
<script src="https://unpkg.com/@gmod/cram/dist/cram-bundle.js"></script>
```

## Docs

- [docs/api.md](docs/api.md): every option, property and method, including
  cancelling a query with an `AbortSignal`
- [docs/workers.md](docs/workers.md): the worker pool that decodes slices in
  parallel in a browser
- [MIGRATION.md](MIGRATION.md): breaking changes, newest first
- [docs/memory.md](docs/memory.md): what a decoded slice keeps in memory
- [docs/read-features.md](docs/read-features.md): the raw alignment encoding
- [docs/codec-support.md](docs/codec-support.md): the codecs this decoder
  handles
- [docs/dataflow.md](docs/dataflow.md): a diagram of a query from index to
  records
- [docs/optimizations.md](docs/optimizations.md): the measurements behind the
  read path's design
- [docs/wasm.md](docs/wasm.md): the inlined wasm build
- [docs/adr/](docs/adr/): design decisions, with their measurements
- [TODO.md](TODO.md): open work
- [CONTRIBUTING.md](CONTRIBUTING.md): development, release and publishing

## Academic use

Written with [NHGRI](http://genome.gov) funding as part of
[JBrowse](http://jbrowse.org). If you use this in a publication, please cite the
most recent JBrowse paper at [jbrowse.org](http://jbrowse.org).

## License

MIT
