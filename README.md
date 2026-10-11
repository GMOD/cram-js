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

const fasta = new IndexedFasta({
  path: '/path/to/reference.fa',
  faiPath: '/path/to/reference.fa.fai',
})

const indexedFile = new IndexedCramFile({
  cramPath: '/path/to/file.cram',
  index: new CraiIndex({ path: '/path/to/file.cram.crai' }),
  fetchReferenceSequence: (seqId, start, end, refName) =>
    fasta.getSequence(refName, start, end),
})

const records = await indexedFile.getRecordsForRange('chr1', 10000, 20000)

for (const record of records) {
  console.log(record.readName, record.start, record.getCigarString())
}
```

`cramPath` can also be `cramUrl` or `cramFilehandle`, and `CraiIndex` takes
`url` or `filehandle` in place of `path`, so the same code runs in a browser.

### Without a bundler

For `<script>`-tag consumers such as igv.js, the package ships a standalone
browser build that puts the same exports on `window.gmodCRAM`:

```html
<script src="https://unpkg.com/@gmod/cram/dist/cram-bundle.js"></script>
<script>
  const { IndexedCramFile, CraiIndex } = window.gmodCRAM
</script>
```

The [example directory](./example) has a working page.

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
1-based format such as SAM's `POS`. [MIGRATION.md](MIGRATION.md) covers the
switch from 1-based coordinates in v10.

## Reference sequence

CRAM stores each read as its differences from the reference, so decoding the
read's bases takes the reference sequence. The `fetchReferenceSequence` callback
supplies it, and its `refName` argument lets a name-keyed source such as
`IndexedFasta` plug in directly, as in the quick start.

Without the callback, records still have positions, CIGAR strings, and the type
and length of each difference, but not the bases. A file written with an
embedded reference (`samtools view --output-fmt-option embed_ref=1`) decodes
fully with no callback, and where a file has both, the library uses the embedded
bases.

## Records

```js
record.getReadBases() // 'ACGT…', the read sequence
record.getCigarString() // '50M2I48M'
record.getMismatches() // every difference from the reference
record.getTag('NM') // one auxiliary tag
record.qualityScoreAt(0) // one base quality
record.isReverseComplemented() // the usual SAM flags
```

`getMismatches()` lists each difference between a read and the reference:

```js
for (const m of record.getMismatches()) {
  console.log(
    String.fromCharCode(m.code), // 'X', 'I', 'D', 'N', 'S' or 'H'
    m.refPos, // 0-based reference position
    m.length, // reference bases covered (deletions, skips)
    m.bases, // substituted or inserted bases
    m.clipLength, // read bases consumed (insertions, clips)
  )
}
```

For bulk processing, `record.forEachMismatch(callback, opts?)` reports the same
differences without allocating an object for each, and takes an optional
`{ start, end }` window. `forEachCigarOp` does the same for the CIGAR, and the
library stores tags and quality scores in one array per slice.
[docs/api.md](docs/api.md) lists every method, and
[docs/memory.md](docs/memory.md) explains the storage layout.

## Worker pool

In a browser, the library decodes the slices of a query in parallel on a shared
pool of web workers. The pool is on by default and needs no configuration,
because the worker is inlined in the bundle like the wasm. Under node, slices
decode in-process.

The pool makes queries that touch four or more slices 2.1-3.6x faster, and
leaves single-slice queries, which are typical of shallow files, about as fast.
Keep it on when you run this library inside your own worker, since those numbers
were measured with the pool nested inside one.

`useSliceWorkerPool: false` disables the pool and `numSliceWorkers` sets its
size. Each worker context starts its own pool, so a host that runs several
contexts may want a smaller one. [docs/workers.md](docs/workers.md) has the
measurements.

## Reading over HTTP

An indexed query reads one byte range per slice and two small ones per
container, so a whole-reference query on a 141 KB test file makes 202 reads. A
bare `RemoteFile` sends a separate range request for each read.
[`@gmod/range-cache-filehandle`](https://github.com/GMOD/range-cache-filehandle)
serves the reads from 256 KiB chunks, so neighboring reads share a request and
the 202 reads become a handful of requests:

```js
import { RemoteFileWithRangeCache } from '@gmod/range-cache-filehandle'

const cram = new IndexedCramFile({
  cramFilehandle: new RemoteFileWithRangeCache(url),
  index: new CraiIndex({
    filehandle: new RemoteFileWithRangeCache(`${url}.crai`),
  }),
})
```

The cache also passes the query's `AbortSignal` to `fetch`, so cancelling a
query cancels its network requests.

## Cancelling a query

Pass an `AbortSignal`, and on abort the query stops decoding and cancels the
read it has in flight:

```js
const controller = new AbortController()
const records = indexedFile.getRecordsForRange('chr1', 1000, 2000, {
  signal: controller.signal,
})
controller.abort() // `records` rejects with an AbortError
```

Concurrent queries share slice decodes, and the library cancels a shared decode
when every query waiting on it has aborted. Aborting one query therefore leaves
the others running. A query without a signal cannot abort, so a decode it waits
on runs to completion for every query sharing it; pass the signal to every
query. [docs/api.md](docs/api.md#cancelling-a-query) has the details.

## Reference ids

CRAM numbers each reference by the position of its `@SQ` line in the header, and
`record.sequenceId` holds that number. Every method that takes a reference name
also accepts the number. Unplaced reads have a `sequenceId` of `-1` and no name,
so you query them by number:

```js
await indexedFile.cram.getReferenceName(record.sequenceId) // 'chr1'
await indexedFile.getRecordsForRange(-1, -1, end) // unplaced reads
```

## Docs

- [docs/api.md](docs/api.md): every option, property and method
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
- [docs/workers.md](docs/workers.md): the slice worker pool
- [docs/adr/](docs/adr/): design decisions, with their measurements
- [TODO.md](TODO.md): open work
- [CONTRIBUTING.md](CONTRIBUTING.md): development, release and publishing

## Academic use

Written with [NHGRI](http://genome.gov) funding as part of
[JBrowse](http://jbrowse.org). If you use this in a publication, please cite the
most recent JBrowse paper at [jbrowse.org](http://jbrowse.org).

## License

MIT © [Robert Buels](https://github.com/rbuels)
